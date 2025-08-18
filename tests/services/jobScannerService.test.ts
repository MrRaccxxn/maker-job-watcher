import { JobScannerService } from '../../src/services/jobScannerService';
import { JobChecker } from '../../src/core/jobChecker';
import { RpcClient } from '../../src/integrations/rpc';
import { DiscordNotifier } from '../../src/integrations/discord';
import { MetricsPublisher } from '../../src/integrations/metrics';

jest.mock('../../src/core/jobChecker');
jest.mock('../../src/integrations/rpc');
jest.mock('../../src/integrations/discord');
jest.mock('../../src/integrations/metrics');
jest.mock('../../src/utils/logger', () => ({
  logger: {
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn(),
    addContext: jest.fn(),
  },
  EnhancedLogger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn(),
  })),
}));
jest.mock('ethers');

describe('JobScannerService', () => {
  let jobScannerService: JobScannerService;
  let mockJobChecker: jest.Mocked<JobChecker>;
  let mockRpcClient: jest.Mocked<RpcClient>;
  let mockDiscordNotifier: jest.Mocked<DiscordNotifier>;
  let mockMetricsPublisher: jest.Mocked<MetricsPublisher>;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  const config = {
    rpcUrl: 'https://test-rpc.com',
    discordWebhookUrl: 'https://discord.com/webhook',
    sequencerAddress: '0x1234567890123456789012345678901234567890',
    blocksToAnalyze: 10,
    network: '0x' + '1'.padStart(64, '0'),
  };

  beforeEach(() => {
    // Suppress console output during tests to reduce noise
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    mockJobChecker = {
      analyzeBlocks: jest.fn(),
      analyzeBlock: jest.fn(),
      determineStaleJobs: jest.fn(),
      checkJobWorkability: jest.fn(),
      performJobCheck: jest.fn(),
    } as unknown as jest.Mocked<JobChecker>;

    mockRpcClient = {
      getJobAddresses: jest.fn(),
      checkJobsWorkability: jest.fn(),
      getLatestBlockNumber: jest.fn(),
      getBlockRange: jest.fn(),
      batchCall: jest.fn(),
      getLogs: jest.fn(),
    } as unknown as jest.Mocked<RpcClient>;

    mockDiscordNotifier = {
      sendAlert: jest.fn(),
      sendTestMessage: jest.fn(),
      sendRecoveryNotification: jest.fn(),
      sendErrorAlert: jest.fn(),
    } as unknown as jest.Mocked<DiscordNotifier>;

    mockMetricsPublisher = {
      publishMetrics: jest.fn(),
      publishHealthCheck: jest.fn(),
      publishJobMetrics: jest.fn(),
      publishCustomMetric: jest.fn(),
    } as unknown as jest.Mocked<MetricsPublisher>;

    (JobChecker as jest.Mock).mockImplementation(() => mockJobChecker);
    (RpcClient as jest.Mock).mockImplementation(() => mockRpcClient);
    (DiscordNotifier as jest.Mock).mockImplementation(() => mockDiscordNotifier);
    (MetricsPublisher as jest.Mock).mockImplementation(() => mockMetricsPublisher);

    jobScannerService = new JobScannerService(config);
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('scanJobs', () => {
    it('should successfully scan jobs and send alerts', async () => {
      const jobAddresses = [
        '0xjob1',
        '0xjob2',
        '0xjob3',
      ];

      const staleJobs = [
        {
          address: '0xjob2',
          workable: true,
          isStale: true,
        },
      ];

      // Mock the provider getBlockNumber method
      const mockProvider = {
        getBlockNumber: jest.fn().mockResolvedValue(1010),
      };
      
      // Mock ethers.JsonRpcProvider
      jest.doMock('ethers', () => ({
        JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
        ethers: {
          JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
        },
      }));

      mockRpcClient.getJobAddresses.mockResolvedValue(jobAddresses);
      mockJobChecker.performJobCheck.mockResolvedValue({
        totalJobs: 3,
        staleJobs: staleJobs,
        lastAnalyzedBlock: 1010,
        rpcCallsCount: 3,
      });
      mockDiscordNotifier.sendAlert.mockResolvedValue(true);
      mockMetricsPublisher.publishMetrics.mockResolvedValue(true);
      mockMetricsPublisher.publishHealthCheck.mockResolvedValue(true);
      mockMetricsPublisher.publishJobMetrics.mockResolvedValue(true);
      mockMetricsPublisher.publishCustomMetric.mockResolvedValue(true);

      const result = await jobScannerService.scanJobs();

      expect(result.success).toBe(true);
      expect(result.result?.totalJobs).toBe(3);
      expect(result.result?.staleJobs).toHaveLength(1);
      expect(result.result?.staleJobs[0].address).toBe('0xjob2');
      expect(result.metrics.alertsSent).toBe(1);

      expect(mockRpcClient.getJobAddresses).toHaveBeenCalledWith(config.sequencerAddress);
      expect(mockJobChecker.performJobCheck).toHaveBeenCalledWith(jobAddresses, config.blocksToAnalyze);
      expect(mockDiscordNotifier.sendAlert).toHaveBeenCalledWith(staleJobs, 3);
      expect(mockMetricsPublisher.publishMetrics).toHaveBeenCalled();
      expect(mockMetricsPublisher.publishHealthCheck).toHaveBeenCalledWith(true);
    });

    it('should handle no jobs found', async () => {
      mockRpcClient.getJobAddresses.mockResolvedValue([]);
      mockMetricsPublisher.publishMetrics.mockResolvedValue(true);

      // Mock provider for getBlockNumber call
      const mockProvider = {
        getBlockNumber: jest.fn().mockResolvedValue(1010),
      };
      jest.doMock('ethers', () => ({
        JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
      }));

      const result = await jobScannerService.scanJobs();

      expect(result.success).toBe(true);
      expect(result.result?.totalJobs).toBe(0);
      expect(result.result?.staleJobs).toHaveLength(0);
      expect(mockDiscordNotifier.sendAlert).not.toHaveBeenCalled();
    });

    it('should handle no stale jobs', async () => {
      const jobAddresses = ['0xjob1', '0xjob2'];

      const mockProvider = {
        getBlockNumber: jest.fn().mockResolvedValue(1010),
      };
      jest.doMock('ethers', () => ({
        JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
      }));

      mockRpcClient.getJobAddresses.mockResolvedValue(jobAddresses);
      mockJobChecker.performJobCheck.mockResolvedValue({
        totalJobs: 2,
        staleJobs: [],
        lastAnalyzedBlock: 1010,
        rpcCallsCount: 3,
      });
      mockMetricsPublisher.publishMetrics.mockResolvedValue(true);
      mockMetricsPublisher.publishHealthCheck.mockResolvedValue(true);
      mockMetricsPublisher.publishJobMetrics.mockResolvedValue(true);
      mockMetricsPublisher.publishCustomMetric.mockResolvedValue(true);

      const result = await jobScannerService.scanJobs();

      expect(result.success).toBe(true);
      expect(result.result?.staleJobs).toHaveLength(0);
      expect(mockDiscordNotifier.sendAlert).toHaveBeenCalledWith([], 2);
    });

    it('should handle errors gracefully', async () => {
      mockRpcClient.getJobAddresses.mockRejectedValue(new Error('RPC error'));
      mockMetricsPublisher.publishMetrics.mockResolvedValue(true);
      mockMetricsPublisher.publishHealthCheck.mockResolvedValue(true);

      const result = await jobScannerService.scanJobs();

      expect(result.success).toBe(false);
      expect(result.error).toContain('RPC error');
      expect(result.metrics.rpcFailures).toBe(1);
      expect(mockMetricsPublisher.publishHealthCheck).toHaveBeenCalledWith(false);
    });

    it('should handle Discord notification failure', async () => {
      const jobAddresses = ['0xjob1'];

      const mockProvider = {
        getBlockNumber: jest.fn().mockResolvedValue(1010),
      };
      jest.doMock('ethers', () => ({
        JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
      }));

      mockRpcClient.getJobAddresses.mockResolvedValue(jobAddresses);
      mockJobChecker.performJobCheck.mockResolvedValue({
        totalJobs: 1,
        staleJobs: [{ 
          address: '0xjob1', 
          workable: true, 
          isStale: true 
        }],
        lastAnalyzedBlock: 1010,
        rpcCallsCount: 3,
      });
      mockDiscordNotifier.sendAlert.mockResolvedValue(false);
      mockMetricsPublisher.publishMetrics.mockResolvedValue(true);
      mockMetricsPublisher.publishHealthCheck.mockResolvedValue(true);
      mockMetricsPublisher.publishJobMetrics.mockResolvedValue(true);
      mockMetricsPublisher.publishCustomMetric.mockResolvedValue(true);

      const result = await jobScannerService.scanJobs();

      expect(result.success).toBe(true);
      expect(result.metrics.rpcFailures).toBe(1); // Discord failure counts as RPC failure
      expect(result.metrics.alertsSent).toBe(0);
    });
  });

  describe('testConnectivity', () => {
    it('should test all integrations', async () => {
      const mockProvider = {
        getBlockNumber: jest.fn().mockResolvedValue(1000),
      };
      jest.doMock('ethers', () => ({
        JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
      }));

      mockDiscordNotifier.sendTestMessage.mockResolvedValue(true);
      mockMetricsPublisher.publishCustomMetric.mockResolvedValue(true);
      mockRpcClient.getJobAddresses.mockResolvedValue(['0xjob1']);

      const result = await jobScannerService.testConnectivity();

      expect(result.rpcConnected).toBe(true);
      expect(result.discordConnected).toBe(true);
      expect(result.metricsConnected).toBe(true);
      expect(result.sequencerAccessible).toBe(true);
    });

    it('should handle connectivity failures', async () => {
      const mockProvider = {
        getBlockNumber: jest.fn().mockRejectedValue(new Error('RPC error')),
      };

      mockDiscordNotifier.sendTestMessage.mockResolvedValue(false);
      mockMetricsPublisher.publishCustomMetric.mockResolvedValue(false);
      mockRpcClient.getJobAddresses.mockRejectedValue(new Error('Contract error'));

      // Create a new service instance with the failing mocks
      const failingJobScannerService = new JobScannerService(config);
      // Replace the provider with our mock
      (failingJobScannerService as any).provider = mockProvider;

      const result = await failingJobScannerService.testConnectivity();

      expect(result.rpcConnected).toBe(false);
      expect(result.discordConnected).toBe(false);
      expect(result.metricsConnected).toBe(false);
      expect(result.sequencerAccessible).toBe(false);
    });
  });

  describe('getJobsStatus', () => {
    it('should return current jobs status', async () => {
      const jobAddresses = ['0xjob1', '0xjob2', '0xjob3'];
      const currentBlock = 1010;


      mockRpcClient.getJobAddresses.mockResolvedValue(jobAddresses);
      mockRpcClient.getLatestBlockNumber.mockResolvedValue(currentBlock);

      const result = await jobScannerService.getJobsStatus();

      expect(result.totalJobs).toBe(3);
      expect(result.jobAddresses).toEqual(jobAddresses);
      expect(result.currentBlock).toBe(currentBlock);
    });
  });
});