import { ethers } from 'ethers';
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

      // Step 2: Analyze recent blocks for job activity
      console.log(`Analyzing last ${this.config.blocksToAnalyze} blocks...`);
      const result = await this.performJobAnalysis(jobAddresses);

      // Step 3: Publish job metrics
      await this.publishJobMetrics(result);

      // Step 4: Send Discord status update (always sent now)
      console.log(`Sending Discord status update: ${result.staleJobs.length} stale jobs found out of ${result.totalJobs} total`);
      const alertSuccess = await this.discordNotifier.sendAlert(result.staleJobs, result.totalJobs);
      if (alertSuccess) {
        alertsSent = 1;
        console.log('Discord status update sent successfully');
      } else {
        console.error('Failed to send Discord status update');
        rpcFailures++;
      }

      // Step 5: Publish execution metrics
      const metrics: MetricsData = {
        jobsNotWorkedCount: result.staleJobs.length,
        rpcFailures,
        alertsSent,
        executionDuration: Date.now() - startTime,
      };

      await this.metricsPublisher.publishMetrics(metrics);
      await this.metricsPublisher.publishHealthCheck(true);

      console.log(`Job scan completed successfully in ${metrics.executionDuration}ms`);

      return {
        success: true,
        result,
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

  private async performJobAnalysis(jobAddresses: string[]): Promise<JobCheckResult> {
    console.log(`Analyzing last ${this.config.blocksToAnalyze} blocks...`);
    
    // Use the optimized JobChecker that performs batch operations
    // This reduces RPC calls from ~18 to 3-4:
    // 1. Get latest block number
    // 2. Batch get all blocks 
    // 3. Batch check workability (if needed)
    return await this.jobChecker.performJobCheck(jobAddresses, this.config.blocksToAnalyze);
  }

  private async publishJobMetrics(result: JobCheckResult): Promise<void> {
    try {
      const workableStaleJobs = result.staleJobs.filter(job => job.workable).length;
      
      await this.metricsPublisher.publishJobMetrics(
        result.totalJobs,
        workableStaleJobs,
        result.staleJobs.length
      );

      // Publish additional metrics
      await this.metricsPublisher.publishCustomMetric(
        'LastAnalyzedBlock',
        result.lastAnalyzedBlock,
        'Count'
      );

      await this.metricsPublisher.publishCustomMetric(
        'RpcCallsPerExecution',
        result.rpcCallsCount,
        'Count'
      );

    } catch (error) {
      console.error('Error publishing job metrics:', error);
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
