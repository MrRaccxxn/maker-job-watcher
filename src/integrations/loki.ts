import fetch from 'node-fetch';

export interface LokiLogEntry {
  timestamp: string;
  level: string;
  message: string;
  labels: Record<string, string>;
  context?: any;
}

export class LokiLogger {
  private readonly lokiUrl: string;
  private readonly batchSize: number = 100;
  private readonly flushInterval: number = 5000; // 5 seconds
  private batch: LokiLogEntry[] = [];
  private timer?: NodeJS.Timeout;

  constructor(lokiUrl?: string) {
    this.lokiUrl = lokiUrl || process.env.LOKI_URL || 'http://localhost:3100';
    
    // Auto-flush on process exit
    process.on('beforeExit', () => this.flush());
    process.on('SIGINT', () => this.flush());
    process.on('SIGTERM', () => this.flush());
  }

  public async log(entry: LokiLogEntry): Promise<void> {
    this.batch.push(entry);

    if (this.batch.length >= this.batchSize) {
      await this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }

  public async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    const logs = this.batch.splice(0); // Clear batch
    
    try {
      await this.sendToLoki(logs);
    } catch (error) {
      console.error('Failed to send logs to Loki:', error);
      // In production, you might want to retry or send to a dead letter queue
    }
  }

  private async sendToLoki(logs: LokiLogEntry[]): Promise<void> {
    // Group logs by labels for Loki streams
    const streams = new Map<string, Array<[string, string]>>();

    for (const log of logs) {
      const labelString = JSON.stringify(log.labels);
      if (!streams.has(labelString)) {
        streams.set(labelString, []);
      }
      
      const logLine = JSON.stringify({
        level: log.level,
        message: log.message,
        ...(log.context && { context: log.context }),
      });
      
      streams.get(labelString)!.push([
        (new Date(log.timestamp).getTime() * 1000000).toString(), // Loki expects nanoseconds
        logLine,
      ]);
    }

    const payload = {
      streams: Array.from(streams.entries()).map(([labels, values]) => ({
        stream: JSON.parse(labels),
        values,
      })),
    };

    const response = await fetch(`${this.lokiUrl}/loki/api/v1/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Loki responded with ${response.status}: ${await response.text()}`);
    }
  }
}

// Enhanced logger that supports both console and Loki
export class HybridLogger {
  private lokiLogger?: LokiLogger;
  private serviceName: string;

  constructor(serviceName: string = 'maker-job-watcher', lokiUrl?: string) {
    this.serviceName = serviceName;
    
    if (lokiUrl || process.env.LOKI_URL) {
      this.lokiLogger = new LokiLogger(lokiUrl);
    }
  }

  public async log(level: string, message: string, context?: any): Promise<void> {
    const timestamp = new Date().toISOString();
    
    // Always log to console for CloudWatch
    console.log(JSON.stringify({
      timestamp,
      level,
      service: this.serviceName,
      message,
      ...(context && { context }),
    }));

    // Also send to Loki if configured
    if (this.lokiLogger) {
      await this.lokiLogger.log({
        timestamp,
        level,
        message,
        labels: {
          service: this.serviceName,
          level: level.toLowerCase(),
          environment: process.env.NODE_ENV || 'production',
        },
        context,
      });
    }
  }

  public async info(message: string, context?: any): Promise<void> {
    return this.log('INFO', message, context);
  }

  public async warn(message: string, context?: any): Promise<void> {
    return this.log('WARN', message, context);
  }

  public async error(message: string, context?: any): Promise<void> {
    return this.log('ERROR', message, context);
  }

  public async debug(message: string, context?: any): Promise<void> {
    if (process.env.LOG_LEVEL === 'DEBUG') {
      return this.log('DEBUG', message, context);
    }
  }

  public async flush(): Promise<void> {
    if (this.lokiLogger) {
      await this.lokiLogger.flush();
    }
  }
}