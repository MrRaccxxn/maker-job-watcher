import fetch from "node-fetch";

export interface LokiOnlyConfig {
  lokiUrl: string;
  lokiUsername?: string;
  lokiToken?: string;
}

export class LokiOnlyLogger {
  private config: LokiOnlyConfig;
  private batchSize: number = 100;
  private flushInterval: number = 5000;
  private logBatch: any[] = [];
  private timer?: NodeJS.Timeout;

  constructor(config: LokiOnlyConfig) {
    this.config = config;

    // Auto-flush on process exit
    process.on("beforeExit", () => this.flush());
    process.on("SIGINT", () => this.flush());
    process.on("SIGTERM", () => this.flush());
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
        service: "maker-job-watcher",
        level: level.toLowerCase(),
        environment: process.env.NODE_ENV || "production",
        function_name: process.env.AWS_LAMBDA_FUNCTION_NAME || "local",
        aws_region: process.env.AWS_REGION || "local",
        ...labels,
      },
      values: [
        [
          timestamp.toString(),
          JSON.stringify({
            level,
            message,
            timestamp: new Date().toISOString(),
            ...(context && { context }),
          }),
        ],
      ],
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
      console.error("❌ Failed to send logs to Loki:", error);
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

    // Prepare headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Add authentication if credentials are provided (for Grafana Cloud)
    if (this.config.lokiUsername && this.config.lokiToken) {
      const lokiAuth = Buffer.from(
        `${this.config.lokiUsername}:${this.config.lokiToken}`
      ).toString("base64");
      headers.Authorization = `Basic ${lokiAuth}`;
    }

    const response = await fetch(`${this.config.lokiUrl}/loki/api/v1/push`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Loki error: ${response.status} - ${await response.text()}`
      );
    }

    console.log(`✅ Sent ${logs.length} logs to Loki`);
  }

  // Test connection to Loki by sending an empty streams payload
  public async testConnection(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Add authentication if credentials are provided
      if (this.config.lokiUsername && this.config.lokiToken) {
        const lokiAuth = Buffer.from(
          `${this.config.lokiUsername}:${this.config.lokiToken}`
        ).toString("base64");
        headers.Authorization = `Basic ${lokiAuth}`;
      }

      const response = await fetch(`${this.config.lokiUrl}/loki/api/v1/push`, {
        method: "POST",
        headers,
        body: JSON.stringify({ streams: [] }),
      });

      if (response.ok) {
        console.log("✅ Successfully connected to Loki");
        return true;
      } else {
        console.error(`❌ Loki connection failed: ${response.status}`);
        return false;
      }
    } catch (error) {
      console.error("❌ Failed to connect to Loki:", error);
      return false;
    }
  }
}

// Factory function for Loki-only logging
export function createLokiOnlyLogger(): LokiOnlyLogger | null {
  const config = {
    lokiUrl: process.env.GRAFANA_LOKI_URL || process.env.LOKI_URL,
    lokiUsername: process.env.GRAFANA_LOKI_USERNAME,
    lokiToken: process.env.GRAFANA_LOKI_TOKEN,
  };

  // Check if Loki URL is present (required)
  if (!config.lokiUrl) {
    console.warn("⚠️ Loki URL not configured, skipping Loki logging");
    return null;
  }

  // Check if using Grafana Cloud (requires auth) or local Loki (no auth)
  const isGrafanaCloud = config.lokiUrl.includes('grafana.net');
  if (isGrafanaCloud && (!config.lokiUsername || !config.lokiToken)) {
    console.warn("⚠️ Grafana Cloud requires username and token, skipping Loki logging");
    return null;
  }

  if (!isGrafanaCloud) {
    console.log("🚀 Using local Loki instance (no authentication required)");
  } else {
    console.log("🚀 Using Grafana Cloud Loki (with authentication)");
  }

  return new LokiOnlyLogger(config as LokiOnlyConfig);
}
