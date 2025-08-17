import fetch from 'node-fetch';

export interface RemoteGrafanaConfig {
  baseUrl: string;      // e.g., "https://your-grafana.com"
  username?: string;    // Basic auth username
  password?: string;    // Basic auth password  
  apiKey?: string;      // API key (preferred)
  lokiUrl?: string;     // If different from baseUrl
}

export class RemoteGrafanaLogger {
  private config: RemoteGrafanaConfig;
  private batchSize: number = 50;
  private flushInterval: number = 10000; // 10 seconds
  private logBatch: any[] = [];
  private timer?: NodeJS.Timeout;

  constructor(config: RemoteGrafanaConfig) {
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
        source: 'lambda',
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
      await this.sendLogsToLoki(logs);
    } catch (error) {
      console.error('Failed to send logs to remote Grafana:', error);
    }
  }

  private async sendLogsToLoki(logs: any[]): Promise<void> {
    // Group logs by stream labels for efficiency
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

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Authentication
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    } else if (this.config.username && this.config.password) {
      const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }

    const lokiUrl = this.config.lokiUrl || `${this.config.baseUrl}/loki`;
    
    const response = await fetch(`${lokiUrl}/api/v1/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Remote Grafana error: ${response.status} - ${errorText}`);
    }

    console.log(`✅ Sent ${logs.length} logs to remote Grafana`);
  }

  // Test connection to remote Grafana
  public async testConnection(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      } else if (this.config.username && this.config.password) {
        const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
      }

      const response = await fetch(`${this.config.baseUrl}/api/health`, {
        method: 'GET',
        headers,
      });

      if (response.ok) {
        console.log('✅ Successfully connected to remote Grafana');
        return true;
      } else {
        console.error(`❌ Grafana health check failed: ${response.status}`);
        return false;
      }
    } catch (error) {
      console.error('❌ Failed to connect to remote Grafana:', error);
      return false;
    }
  }
}

// Factory function for remote Grafana
export function createRemoteGrafanaLogger(): RemoteGrafanaLogger | null {
  const baseUrl = process.env.REMOTE_GRAFANA_URL;
  
  if (!baseUrl) {
    return null;
  }

  const config: RemoteGrafanaConfig = {
    baseUrl,
    apiKey: process.env.REMOTE_GRAFANA_API_KEY,
    username: process.env.REMOTE_GRAFANA_USERNAME,
    password: process.env.REMOTE_GRAFANA_PASSWORD,
    lokiUrl: process.env.REMOTE_GRAFANA_LOKI_URL,
  };

  return new RemoteGrafanaLogger(config);
}