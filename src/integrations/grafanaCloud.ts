import fetch from 'node-fetch';

export interface GrafanaCloudConfig {
  lokiUrl: string;            // e.g., "https://logs-prod-us-central1.grafana.net"
  prometheusUrl: string;      // e.g., "https://prometheus-us-central1.grafana.net"
  lokiUsername: string;       // Loki username (usually numeric)
  lokiToken: string;          // Loki service account token
  prometheusUsername: string; // Prometheus username (usually numeric)  
  prometheusToken: string;    // Prometheus service account token
  instanceId: string;         // Your instance ID
}

export class GrafanaCloudLogger {
  private config: GrafanaCloudConfig;
  private batchSize: number = 100;
  private flushInterval: number = 5000;
  private logBatch: any[] = [];
  private metricsBatch: any[] = [];
  private timer?: NodeJS.Timeout;

  constructor(config: GrafanaCloudConfig) {
    this.config = config;
    
    // Auto-flush on process exit
    process.on('beforeExit', () => this.flush());
    process.on('SIGINT', () => this.flush());
    process.on('SIGTERM', () => this.flush());
  }

  public async sendLog(
    level: string, 
    message: string, 
    labels: Record<string, string> = {}, 
    context?: any
  ): Promise<void> {
    const timestamp = Date.now() * 1000000; // Loki expects nanoseconds
    
    const logEntry = {
      stream: {
        service: 'maker-job-watcher',
        level: level.toLowerCase(),
        environment: process.env.NODE_ENV || 'production',
        ...labels,
      },
      values: [[
        timestamp.toString(),
        JSON.stringify({
          level,
          message,
          timestamp: new Date().toISOString(),
          ...(context && { context }),
        }),
      ]],
    };

    this.logBatch.push(logEntry);
    await this.checkFlush();
  }

  public async sendMetric(
    name: string, 
    value: number, 
    labels: Record<string, string> = {},
    timestamp?: number
  ): Promise<void> {
    const metric = {
      name: `maker_job_watcher_${name}`,
      value,
      timestamp: timestamp || Date.now(),
      labels: {
        service: 'maker-job-watcher',
        environment: process.env.NODE_ENV || 'production',
        ...labels,
      },
    };

    this.metricsBatch.push(metric);
    await this.checkFlush();
  }

  private async checkFlush(): Promise<void> {
    if (this.logBatch.length >= this.batchSize || this.metricsBatch.length >= this.batchSize) {
      await this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }

  public async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    const promises: Promise<void>[] = [];

    if (this.logBatch.length > 0) {
      promises.push(this.flushLogs());
    }

    if (this.metricsBatch.length > 0) {
      promises.push(this.flushMetrics());
    }

    await Promise.allSettled(promises);
  }

  private async flushLogs(): Promise<void> {
    const logs = this.logBatch.splice(0);
    
    try {
      // Group logs by stream labels
      const streams = new Map<string, any[]>();
      
      for (const log of logs) {
        const streamKey = JSON.stringify(log.stream);
        if (!streams.has(streamKey)) {
          streams.set(streamKey, []);
        }
        streams.get(streamKey)!.push(...log.values);
      }

      const payload = {
        streams: Array.from(streams.entries()).map(([streamLabels, values]) => ({
          stream: JSON.parse(streamLabels),
          values,
        })),
      };

      // Use Service Account Token for Loki
      const lokiAuth = Buffer.from(`${this.config.lokiUsername}:${this.config.lokiToken}`).toString('base64');
      
      const response = await fetch(`${this.config.lokiUrl}/loki/api/v1/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${lokiAuth}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Grafana Cloud Loki error: ${response.status} - ${await response.text()}`);
      }

      console.log(`✅ Sent ${logs.length} logs to Grafana Cloud Loki`);
    } catch (error) {
      console.error('❌ Failed to send logs to Grafana Cloud:', error);
      // In production, consider retrying or storing in dead letter queue
    }
  }

  private async flushMetrics(): Promise<void> {
    const metrics = this.metricsBatch.splice(0);
    
    try {
      // Convert to Prometheus remote write format
      const samples = metrics.map(metric => ({
        labels: Object.entries(metric.labels).map(([name, value]) => ({
          name,
          value: String(value),
        })),
        samples: [{
          value: metric.value,
          timestamp: metric.timestamp,
        }],
        name: metric.name,
      }));

      // Use Service Account Token for Prometheus
      const prometheusAuth = Buffer.from(`${this.config.prometheusUsername}:${this.config.prometheusToken}`).toString('base64');
      
      const response = await fetch(`${this.config.prometheusUrl}/api/v1/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${prometheusAuth}`,
        },
        body: JSON.stringify({ samples }),
      });

      if (!response.ok) {
        throw new Error(`Grafana Cloud Prometheus error: ${response.status} - ${await response.text()}`);
      }

      console.log(`✅ Sent ${metrics.length} metrics to Grafana Cloud Prometheus`);
    } catch (error) {
      console.error('❌ Failed to send metrics to Grafana Cloud:', error);
    }
  }
}

// Factory function to create Grafana Cloud logger from environment
export function createGrafanaCloudLogger(): GrafanaCloudLogger | null {
  const config = {
    lokiUrl: process.env.GRAFANA_CLOUD_LOKI_URL,
    prometheusUrl: process.env.GRAFANA_CLOUD_PROMETHEUS_URL,
    lokiUsername: process.env.GRAFANA_CLOUD_LOKI_USERNAME,
    lokiToken: process.env.GRAFANA_CLOUD_LOKI_TOKEN,
    prometheusUsername: process.env.GRAFANA_CLOUD_PROMETHEUS_USERNAME,
    prometheusToken: process.env.GRAFANA_CLOUD_PROMETHEUS_TOKEN,
    instanceId: process.env.GRAFANA_CLOUD_INSTANCE_ID,
  };

  // Check if all required config is present
  if (!config.lokiUrl || !config.lokiUsername || !config.lokiToken) {
    console.warn('⚠️ Grafana Cloud Loki config incomplete, skipping cloud logging');
    return null;
  }

  return new GrafanaCloudLogger(config as GrafanaCloudConfig);
}