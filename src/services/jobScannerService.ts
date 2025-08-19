import { ethers } from 'ethers';
import fetch from 'node-fetch';
import { JobChecker } from '../core/jobChecker';
import { RpcClient } from '../integrations/rpc';
import { DiscordNotifier } from '../integrations/discord';
import { MetricsPublisher } from '../integrations/metrics';
import { JobCheckResult, MetricsData } from '../types';
import { logger } from '../utils/logger';

export interface JobScannerConfig {
  rpcUrl: string;
  discordWebhookUrl: string;
  sequencerAddress: string;
  blocksToAnalyze: number;
  network: string;
}

export class JobScannerService {
  private readonly provider: ethers.JsonRpcProvider;
  private readonly jobChecker: JobChecker;
  private readonly rpcClient: RpcClient;
  private readonly discordNotifier: DiscordNotifier;
  private readonly metricsPublisher: MetricsPublisher;
  private readonly config: JobScannerConfig;

  constructor(config: JobScannerConfig) {
    this.config = config;

    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    this.rpcClient = new RpcClient(this.config.rpcUrl, this.provider);
    this.jobChecker = new JobChecker(this.provider, this.rpcClient);
    this.discordNotifier = new DiscordNotifier(this.config.discordWebhookUrl);
    this.metricsPublisher = new MetricsPublisher();

    // Set up logger context
    logger.setContext({
      sequencerAddress: config.sequencerAddress,
      blocksToAnalyze: config.blocksToAnalyze,
      network: config.network,
    });
  }

  public async scanJobs(): Promise<{
    success: boolean;
    result?: JobCheckResult;
    error?: string;
    metrics: MetricsData;
  }> {
    const startTime = Date.now();
    let rpcFailures = 0;
    let alertsSent = 0;

    try {
      logger.addContext('executionId', `scan-${Date.now()}`);
      logger.info('Starting MakerDAO job scan');

      // Step 1: Get all job addresses from the Sequencer contract
      logger.info('Fetching job addresses from Sequencer contract');
      const jobAddresses = await this.getJobAddresses();
      
      if (jobAddresses.length === 0) {
        console.log('No jobs found in Sequencer contract');
        const metrics: MetricsData = {
          jobsNotWorkedCount: 0,
          rpcFailures: 0,
          alertsSent: 0,
          executionDuration: Date.now() - startTime,
        };
        
        await this.metricsPublisher.publishMetrics(metrics);
        
        return {
          success: true,
          result: {
            totalJobs: 0,
            staleJobs: [],
            lastAnalyzedBlock: await this.provider.getBlockNumber(),
            rpcCallsCount: 1,
          },
          metrics,
        };
      }

      console.log(`Found ${jobAddresses.length} jobs to monitor`);

      // Step 2: Check if ANY jobs were worked in recent blocks (using optimized RPC)
      console.log(`Checking if any jobs were worked in last ${this.config.blocksToAnalyze} blocks (optimized)...`);
      const workActivity = await this.jobChecker.checkIfAnyJobsWorkedOptimized(jobAddresses, this.config.blocksToAnalyze);

      // Step 3: Send Discord alert ONLY if NO jobs were worked (per requirement)
      if (workActivity.totalWorkTransactions === 0) {
        console.log(`🚨 NO jobs worked in last ${this.config.blocksToAnalyze} blocks - sending Discord alert`);
        
        // Create simple alert for no job activity
        const noActivityAlert = {
          embeds: [{
            title: '🚨 MakerDAO Job Alert - No Activity Detected',
            description: `No MakerDAO jobs have been executed in the last ${this.config.blocksToAnalyze} blocks.`,
            color: 0xff0000, // Red
            fields: [
              {
                name: '📊 Summary',
                value: `0 work transactions found in ${this.config.blocksToAnalyze} blocks`,
                inline: true,
              },
              {
                name: '📦 Block Range',
                value: `${workActivity.lastAnalyzedBlock - this.config.blocksToAnalyze + 1} to ${workActivity.lastAnalyzedBlock}`,
                inline: true,
              },
              {
                name: '🕐 Time Window',
                value: `~${Math.round(this.config.blocksToAnalyze * 12 / 60)} minutes`,
                inline: true,
              },
              {
                name: '🎯 Jobs Monitored', 
                value: `${jobAddresses.length} jobs`,
                inline: true,
              },
              {
                name: '🚀 RPC Method',
                value: `${workActivity.method} (${workActivity.rpcCallsCount} calls)`,
                inline: true,
              }
            ],
            timestamp: new Date().toISOString(),
          }],
        };

        try {
          const response = await fetch(this.config.discordWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(noActivityAlert),
          });

          if (response.ok) {
            alertsSent = 1;
            console.log('Discord no-activity alert sent successfully');
          } else {
            console.error('Failed to send Discord no-activity alert');
            rpcFailures++;
          }
        } catch (error) {
          console.error('Error sending Discord no-activity alert:', error);
          rpcFailures++;
        }
      } else {
        console.log(`✅ Found ${workActivity.totalWorkTransactions} work transactions in last ${this.config.blocksToAnalyze} blocks - no alert needed`);
      }

      // Step 4: Publish simplified metrics  
      await this.publishSimplifiedMetrics(workActivity, jobAddresses.length);

      // Step 5: Publish execution metrics
      const metrics: MetricsData = {
        jobsNotWorkedCount: workActivity.totalWorkTransactions === 0 ? 1 : 0, // 1 if no activity, 0 if activity
        rpcFailures,
        alertsSent,
        executionDuration: Date.now() - startTime,
      };

      await this.metricsPublisher.publishMetrics(metrics);
      await this.metricsPublisher.publishHealthCheck(true);

      console.log(`Job scan completed successfully in ${Date.now() - startTime}ms`);

      return {
        success: true,
        result: {
          totalJobs: jobAddresses.length,
          staleJobs: [], // Not applicable with new logic
          lastAnalyzedBlock: workActivity.lastAnalyzedBlock,
          rpcCallsCount: workActivity.rpcCallsCount,
        },
        metrics,
      };

    } catch (error) {
      console.error('Job scan failed:', error);
      rpcFailures++;

      // Send error notification to Discord
      try {
        await this.discordNotifier.sendErrorAlert(
          error instanceof Error ? error : new Error('Unknown error'),
          'Job Scanner Service'
        );
      } catch (discordError) {
        console.error('Failed to send Discord error notification:', discordError);
      }

      const metrics: MetricsData = {
        jobsNotWorkedCount: 0,
        rpcFailures,
        alertsSent,
        executionDuration: Date.now() - startTime,
      };

      await this.metricsPublisher.publishMetrics(metrics);
      await this.metricsPublisher.publishHealthCheck(false);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metrics,
      };
    }
  }

  private async getJobAddresses(): Promise<string[]> {
    try {
      return await this.rpcClient.getJobAddresses(this.config.sequencerAddress);
    } catch (error) {
      console.error('Error fetching job addresses:', error);
      throw new Error(`Failed to fetch job addresses: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async publishSimplifiedMetrics(workActivity: any, totalJobs: number): Promise<void> {
    try {
      // Publish metrics for the new simpler logic
      await this.metricsPublisher.publishCustomMetric(
        'TotalWorkTransactions',
        workActivity.totalWorkTransactions,
        'Count'
      );

      await this.metricsPublisher.publishCustomMetric(
        'TotalJobsMonitored',
        totalJobs,
        'Count'
      );

      await this.metricsPublisher.publishCustomMetric(
        'LastAnalyzedBlock',
        workActivity.lastAnalyzedBlock,
        'Count'
      );

      await this.metricsPublisher.publishCustomMetric(
        'RpcCallsPerExecution',
        workActivity.rpcCallsCount,
        'Count'
      );

      // Key metric: 1 if no activity detected, 0 if activity detected
      await this.metricsPublisher.publishCustomMetric(
        'NoJobActivityDetected',
        workActivity.totalWorkTransactions === 0 ? 1 : 0,
        'Count'
      );

      // Track which RPC optimization method was used
      await this.metricsPublisher.publishCustomMetric(
        'RpcOptimizationMethod',
        workActivity.method === 'eth_getLogs' ? 1 : 0, // 1 for optimized, 0 for fallback
        'Count'
      );

    } catch (error) {
      console.error('Error publishing simplified metrics:', error);
    }
  }


  public async testConnectivity(): Promise<{
    rpcConnected: boolean;
    discordConnected: boolean;
    metricsConnected: boolean;
    sequencerAccessible: boolean;
  }> {
    const results = {
      rpcConnected: false,
      discordConnected: false,
      metricsConnected: false,
      sequencerAccessible: false,
    };

    // Test RPC connection
    try {
      await this.provider.getBlockNumber();
      results.rpcConnected = true;
    } catch (error) {
      console.error('RPC connection test failed:', error);
    }

    // Test Discord webhook
    try {
      const discordSuccess = await this.discordNotifier.sendTestMessage();
      results.discordConnected = discordSuccess;
    } catch (error) {
      console.error('Discord connection test failed:', error);
    }

    // Test CloudWatch metrics
    try {
      const metricsSuccess = await this.metricsPublisher.publishCustomMetric(
        'ConnectivityTest',
        1,
        'Count'
      );
      results.metricsConnected = metricsSuccess;
    } catch (error) {
      console.error('Metrics connection test failed:', error);
    }

    // Test Sequencer contract access
    try {
      await this.getJobAddresses();
      results.sequencerAccessible = true;
    } catch (error) {
      console.error('Sequencer contract test failed:', error);
    }

    return results;
  }

  public async getJobsStatus(): Promise<{
    totalJobs: number;
    jobAddresses: string[];
    currentBlock: number;
  }> {
    const jobAddresses = await this.getJobAddresses();
    const currentBlock = await this.rpcClient.getLatestBlockNumber();

    return {
      totalJobs: jobAddresses.length,
      jobAddresses,
      currentBlock,
    };
  }

  public cleanup(): void {
    this.rpcClient.cleanup();
  }
}
