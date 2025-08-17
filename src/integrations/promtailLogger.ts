import * as fs from 'fs';
import * as path from 'path';

export interface PromtailLoggerConfig {
  logDirectory: string;
  maxFileSize: number; // in MB
  maxFiles: number;
  enableRotation: boolean;
}

export class PromtailLogger {
  private config: PromtailLoggerConfig;
  private currentLogFile: string;
  private logQueue: string[] = [];
  private isWriting: boolean = false;

  constructor(config: Partial<PromtailLoggerConfig> = {}) {
    this.config = {
      logDirectory: path.join(process.cwd(), 'logs'),
      maxFileSize: 100, // 100MB
      maxFiles: 10,
      enableRotation: true,
      ...config,
    };

    this.ensureLogDirectory();
    this.currentLogFile = this.generateLogFileName();

    // Auto-flush on process exit
    process.on('beforeExit', () => this.flush());
    process.on('SIGINT', () => this.flush());
    process.on('SIGTERM', () => this.flush());
  }

  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.config.logDirectory)) {
      fs.mkdirSync(this.config.logDirectory, { recursive: true });
    }
  }

  private generateLogFileName(): string {
    const timestamp = new Date().toISOString().split('T')[0];
    return path.join(this.config.logDirectory, `maker-job-watcher-${timestamp}.json`);
  }

  public async writeLog(
    level: string,
    message: string,
    labels: Record<string, string> = {},
    context?: any
  ): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      service: 'maker-job-watcher',
      message,
      labels: {
        environment: process.env.NODE_ENV || 'production',
        aws_region: process.env.AWS_REGION || 'local',
        function_name: process.env.AWS_LAMBDA_FUNCTION_NAME || 'local',
        ...labels,
      },
      ...(context && { context }),
    };

    // Add to queue for batched writing
    this.logQueue.push(JSON.stringify(logEntry));
    
    // Process queue if not already writing
    if (!this.isWriting) {
      await this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isWriting || this.logQueue.length === 0) return;

    this.isWriting = true;

    try {
      // Check if we need to rotate the log file
      if (this.config.enableRotation) {
        await this.checkRotation();
      }

      // Write all queued logs
      const logsToWrite = this.logQueue.splice(0);
      const logContent = logsToWrite.join('\n') + '\n';

      await fs.promises.appendFile(this.currentLogFile, logContent, 'utf8');
      
      console.log(`📝 Wrote ${logsToWrite.length} logs to ${path.basename(this.currentLogFile)}`);
    } catch (error) {
      console.error('❌ Failed to write logs to file:', error);
      // Put logs back in queue for retry
      this.logQueue.unshift(...this.logQueue);
    } finally {
      this.isWriting = false;
    }
  }

  private async checkRotation(): Promise<void> {
    try {
      const stats = await fs.promises.stat(this.currentLogFile);
      const fileSizeMB = stats.size / (1024 * 1024);

      if (fileSizeMB > this.config.maxFileSize) {
        console.log(`🔄 Rotating log file (${fileSizeMB.toFixed(2)}MB > ${this.config.maxFileSize}MB)`);
        
        // Generate new log file name
        this.currentLogFile = this.generateLogFileName();
        
        // Clean up old files
        await this.cleanupOldFiles();
      }
    } catch (error: any) {
      // File doesn't exist yet, which is fine
      if (error?.code !== 'ENOENT') {
        console.warn('Warning: Failed to check file stats for rotation:', error);
      }
    }
  }

  private async cleanupOldFiles(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.config.logDirectory);
      const logFiles = files
        .filter(file => file.startsWith('maker-job-watcher-') && file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(this.config.logDirectory, file),
          stat: fs.statSync(path.join(this.config.logDirectory, file)),
        }))
        .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

      // Keep only the most recent files
      const filesToDelete = logFiles.slice(this.config.maxFiles);
      
      for (const file of filesToDelete) {
        await fs.promises.unlink(file.path);
        console.log(`🗑️ Deleted old log file: ${file.name}`);
      }
    } catch (error) {
      console.warn('Warning: Failed to cleanup old log files:', error);
    }
  }

  public async flush(): Promise<void> {
    if (this.logQueue.length > 0) {
      await this.processQueue();
    }
  }

  // Get current log file info
  public getLogFileInfo(): { currentFile: string; queueSize: number } {
    return {
      currentFile: this.currentLogFile,
      queueSize: this.logQueue.length,
    };
  }

  // Test file writing capability
  public async testWrite(): Promise<boolean> {
    try {
      await this.writeLog('INFO', 'Promtail logger test', { test: 'true' }, { 
        testTimestamp: Date.now() 
      });
      await this.flush();
      return true;
    } catch (error) {
      console.error('❌ Promtail logger test failed:', error);
      return false;
    }
  }
}

// Factory function for Promtail logger
export function createPromtailLogger(): PromtailLogger | null {
  try {
    const config: Partial<PromtailLoggerConfig> = {};

    // Configure based on environment
    if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
      // In Lambda, use /tmp for temporary files
      config.logDirectory = '/tmp/logs';
      config.enableRotation = false; // Lambda instances are short-lived
    } else {
      // Local development
      config.logDirectory = path.join(process.cwd(), 'logs');
      config.enableRotation = true;
    }

    return new PromtailLogger(config);
  } catch (error) {
    console.error('❌ Failed to create Promtail logger:', error);
    return null;
  }
}