import fetch from 'node-fetch';

export interface GrafanaHttpConfig {
  grafanaUrl: string;        // e.g., "https://your-org.grafana.net"
  serviceAccountToken: string; // Service account token (glsa_...)
  orgId?: number;            // Organization ID (optional)
}

export class GrafanaHttpLogger {
  private config: GrafanaHttpConfig;
  private batchSize: number = 50;
  private flushInterval: number = 10000;
  private logBatch: any[] = [];
  private timer?: NodeJS.Timeout;

  constructor(config: GrafanaHttpConfig) {
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
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: 'maker-job-watcher',
      message,
      labels: {
        environment: process.env.NODE_ENV || 'production',
        aws_region: process.env.AWS_REGION || 'unknown',
        function_name: process.env.AWS_LAMBDA_FUNCTION_NAME || 'local',
        ...labels,
      },
      context,
    };

    this.logBatch.push(logEntry);
    await this.checkFlush();
  }

  private async checkFlush(): Promise<void> {
    if (this.logBatch.length >= this.batchSize) {
      await this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }

  public async flush(): Promise<void> {
    if (this.logBatch.length === 0) return;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    const logs = this.logBatch.splice(0);

    try {
      await this.sendLogsToGrafana(logs);
    } catch (error) {
      console.error('Failed to send logs to Grafana:', error);
    }
  }

  private async sendLogsToGrafana(logs: any[]): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.serviceAccountToken}`,
    };

    if (this.config.orgId) {
      headers['X-Grafana-Org-Id'] = this.config.orgId.toString();
    }

    const response = await fetch(`${this.config.grafanaUrl}/api/annotations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        dashboardUID: 'maker-job-watcher', // You can create a dashboard with this UID
        panelId: 1,
        time: Date.now(),
        timeEnd: Date.now(),
        tags: ['maker-job-watcher'],
        text: `Batch of ${logs.length} logs`,
        data: { logs },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Grafana HTTP API error: ${response.status} - ${errorText}`);
    }

    console.log(`✅ Sent ${logs.length} logs to Grafana via HTTP API`);
  }

  // Alternative: Send as custom metrics
  public async sendCustomMetric(
    name: string,
    value: number,
    labels: Record<string, string> = {}
  ): Promise<void> {
    try {
      const metric = {
        name: `maker_job_watcher_${name}`,
        value,
        timestamp: Date.now(),
        labels: {
          service: 'maker-job-watcher',
          environment: process.env.NODE_ENV || 'production',
          ...labels,
        },
      };

      // Send as a custom annotation with metric data
      const response = await fetch(`${this.config.grafanaUrl}/api/annotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.serviceAccountToken}`,
          ...(this.config.orgId && { 'X-Grafana-Org-Id': this.config.orgId.toString() }),
        },
        body: JSON.stringify({
          time: metric.timestamp,
          text: `${name}: ${value}`,
          tags: ['metric', name, ...Object.entries(labels).map(([k, v]) => `${k}:${v}`)],
          data: metric,
        }),
      });

      if (!response.ok) {
        throw new Error(`Metric send failed: ${response.status}`);
      }

      console.log(`✅ Sent metric ${name}=${value} to Grafana`);
    } catch (error) {
      console.error('Failed to send metric to Grafana:', error);
    }
  }

  // Test connection
  public async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.grafanaUrl}/api/org`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.serviceAccountToken}`,
          ...(this.config.orgId && { 'X-Grafana-Org-Id': this.config.orgId.toString() }),
        },
      });

      if (response.ok) {
        const org = await response.json();
        console.log(`✅ Connected to Grafana org: ${org.name}`);
        return true;
      } else {
        console.error(`❌ Grafana connection failed: ${response.status}`);
        return false;
      }
    } catch (error) {
      console.error('❌ Failed to connect to Grafana:', error);
      return false;
    }
  }
}

// Factory function
export function createGrafanaHttpLogger(): GrafanaHttpLogger | null {
  const grafanaUrl = process.env.GRAFANA_HTTP_URL;
  const serviceAccountToken = process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN;

  if (!grafanaUrl || !serviceAccountToken) {
    return null;
  }

  return new GrafanaHttpLogger({
    grafanaUrl,
    serviceAccountToken,
    orgId: process.env.GRAFANA_ORG_ID ? parseInt(process.env.GRAFANA_ORG_ID) : undefined,
  });
}