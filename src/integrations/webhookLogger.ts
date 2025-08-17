import fetch from 'node-fetch';

export interface WebhookLoggerConfig {
  webhookUrl: string;
  batchSize?: number;
  flushInterval?: number;
  headers?: Record<string, string>;
}

export class WebhookLogger {
  private config: WebhookLoggerConfig;
  private logBatch: any[] = [];
  private timer?: NodeJS.Timeout;

  constructor(config: WebhookLoggerConfig) {
    this.config = {
      batchSize: 20,
      flushInterval: 5000,
      ...config,
    };

    // Auto-flush on process exit
    process.on('beforeExit', () => this.flush());
    process.on('SIGINT', () => this.flush());
    process.on('SIGTERM', () => this.flush());
  }

  public async sendLog(
    level: string,
    message: string,
    context?: any,
    labels?: Record<string, string>
  ): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: 'maker-job-watcher',
      message,
      context,
      labels: {
        environment: process.env.NODE_ENV || 'production',
        aws_region: process.env.AWS_REGION || 'unknown',
        function_name: process.env.AWS_LAMBDA_FUNCTION_NAME || 'local',
        ...labels,
      },
    };

    this.logBatch.push(logEntry);
    await this.checkFlush();
  }

  private async checkFlush(): Promise<void> {
    if (this.logBatch.length >= this.config.batchSize!) {
      await this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.config.flushInterval);
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
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify({
          logs,
          metadata: {
            service: 'maker-job-watcher',
            timestamp: new Date().toISOString(),
            count: logs.length,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Webhook error: ${response.status} - ${await response.text()}`);
      }

      console.log(`✅ Sent ${logs.length} logs via webhook`);
    } catch (error) {
      console.error('❌ Failed to send logs via webhook:', error);
      // Consider retrying or storing in dead letter queue
    }
  }
}

// You can use this with services like:
// - Zapier webhooks
// - n8n workflows  
// - Custom log aggregation services
// - Direct to Grafana via HTTP API