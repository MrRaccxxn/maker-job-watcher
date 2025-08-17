export interface LogContext {
  requestId?: string;
  jobAddress?: string;
  blockNumber?: number;
  rpcCallsCount?: number;
  executionTime?: number;
  [key: string]: any;
}

export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG',
}

export class Logger {
  protected context: LogContext = {};
  protected readonly serviceName: string;

  constructor(serviceName: string = 'maker-job-watcher') {
    this.serviceName = serviceName;
    
    // Add Lambda context if available
    if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
      this.context = {
        functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
        functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION,
        awsRegion: process.env.AWS_REGION,
        environment: process.env.NODE_ENV || 'production',
      };
    }
  }

  public setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }

  public addContext(key: string, value: any): void {
    this.context[key] = value;
  }

  protected log(level: LogLevel, message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      service: this.serviceName,
      message,
      context: this.context,
      ...(data && { data }),
    };

    // Output structured JSON for CloudWatch
    console.log(JSON.stringify(logEntry));
  }

  public info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  public warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  public error(message: string, error?: Error | any, data?: any): void {
    const errorData = {
      ...data,
      ...(error && {
        error: {
          message: error.message || error,
          stack: error.stack,
          name: error.name,
        },
      }),
    };
    this.log(LogLevel.ERROR, message, errorData);
  }

  public debug(message: string, data?: any): void {
    if (process.env.LOG_LEVEL === 'DEBUG') {
      this.log(LogLevel.DEBUG, message, data);
    }
  }

  // Specialized logging methods for job monitoring
  public jobScanStarted(totalJobs: number, blocksToAnalyze: number): void {
    this.info('Job scan started', {
      metrics: {
        totalJobs,
        blocksToAnalyze,
      },
    });
  }

  public jobScanCompleted(result: {
    totalJobs: number;
    staleJobs: number;
    rpcCallsCount: number;
    executionTime: number;
  }): void {
    this.info('Job scan completed', {
      metrics: result,
    });
  }

  public rpcCall(method: string, params?: any, startTime?: number): void {
    const executionTime = startTime ? Date.now() - startTime : undefined;
    this.debug('RPC call executed', {
      rpc: {
        method,
        params,
        executionTime,
      },
    });
  }

  public jobAlert(staleJobs: Array<{ address: string; workable: boolean }>): void {
    this.warn('Stale workable jobs detected', {
      alert: {
        count: staleJobs.length,
        jobs: staleJobs,
      },
    });
  }

  public performanceMetrics(metrics: {
    rpcCallsCount: number;
    executionTime: number;
    blockAnalysisTime?: number;
    workabilityCheckTime?: number;
  }): void {
    this.info('Performance metrics', {
      performance: metrics,
    });
  }
}

import { createLokiOnlyLogger, LokiOnlyLogger } from '../integrations/lokiOnly';
import { createPromtailLogger, PromtailLogger } from '../integrations/promtailLogger';

// Enhanced logger with both direct Loki and Promtail support
export class EnhancedLogger extends Logger {
  private lokiLogger: LokiOnlyLogger | null = null;
  private promtailLogger: PromtailLogger | null = null;
  private usePromtail: boolean = false;

  constructor(serviceName: string = 'maker-job-watcher') {
    super(serviceName);
    
    // Decide between Promtail and direct Loki based on environment
    this.usePromtail = process.env.USE_PROMTAIL === 'true' || 
                     process.env.NODE_ENV === 'development' ||
                     !process.env.AWS_LAMBDA_FUNCTION_NAME; // Use Promtail for non-Lambda environments
    
    if (this.usePromtail) {
      console.log('🚀 Initializing Promtail logger for file-based log shipping');
      this.promtailLogger = createPromtailLogger();
    } else {
      console.log('🚀 Initializing direct Loki logger for HTTP log shipping');
      this.lokiLogger = createLokiOnlyLogger();
    }
  }

  protected async log(level: LogLevel, message: string, data?: any): Promise<void> {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      service: 'maker-job-watcher',
      message,
      context: this.context,
      ...(data && { data }),
    };

    // Always log to console for CloudWatch
    console.log(JSON.stringify(logEntry));

    // Send to either Promtail (file) or Loki (HTTP) based on configuration
    if (this.usePromtail && this.promtailLogger) {
      try {
        await this.promtailLogger.writeLog(level, message, {
          execution_id: String(this.context.executionId || ''),
          job_count: String(this.context.totalJobs || 0),
          rpc_calls: String(this.context.rpcCallsCount || 0),
        }, { ...this.context, ...data });
      } catch (error) {
        console.error('Failed to write log to Promtail file:', error);
      }
    } else if (this.lokiLogger) {
      try {
        await this.lokiLogger.sendLog(level, message, {
          execution_id: String(this.context.executionId || ''),
          job_count: String(this.context.totalJobs || 0),
          rpc_calls: String(this.context.rpcCallsCount || 0),
        }, { ...this.context, ...data });
      } catch (error) {
        console.error('Failed to send log to Loki:', error);
      }
    }
  }

  public async sendMetric(name: string, value: number, labels?: Record<string, string>): Promise<void> {
    // Metrics not supported in Loki-only mode - log as structured message instead
    this.info(`Metric: ${name}`, {
      metric: {
        name,
        value,
        labels,
      },
    });
  }

  public async flush(): Promise<void> {
    if (this.usePromtail && this.promtailLogger) {
      await this.promtailLogger.flush();
    } else if (this.lokiLogger) {
      await this.lokiLogger.flush();
    }
  }

  // Get logger info for debugging
  public getLoggerInfo(): { type: string; status: string; info?: any } {
    if (this.usePromtail && this.promtailLogger) {
      return {
        type: 'promtail',
        status: 'active',
        info: this.promtailLogger.getLogFileInfo(),
      };
    } else if (this.lokiLogger) {
      return {
        type: 'direct-loki',
        status: 'active',
      };
    }
    return {
      type: 'console-only',
      status: 'fallback',
    };
  }
}

// Global logger instance
export const logger = new EnhancedLogger();