import { ethers } from 'ethers';
import { JobChecker } from '../../src/core/jobChecker';
import { RpcClient } from '../../src/integrations/rpc';
import { BlockAnalysisResult } from '../../src/types';

jest.mock('ethers');
jest.mock('../../src/integrations/rpc');

describe('JobChecker', () => {
  let jobChecker: JobChecker;
  let mockProvider: jest.Mocked<ethers.JsonRpcProvider>;
  let mockRpcClient: jest.Mocked<RpcClient>;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Suppress console output during error tests to reduce noise
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    mockProvider = {
      getBlockNumber: jest.fn(),
      getBlock: jest.fn(),
    } as unknown as jest.Mocked<ethers.JsonRpcProvider>;

    mockRpcClient = {
      getBlockRange: jest.fn(),
      getLatestBlockNumber: jest.fn(),
      checkJobsWorkability: jest.fn(),
      batchCall: jest.fn(),
      getJobAddresses: jest.fn(),
      getLogs: jest.fn(),
    } as unknown as jest.Mocked<RpcClient>;

    jobChecker = new JobChecker(mockProvider, mockRpcClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy.mockRestore();
  });

  describe('analyzeBlock', () => {
    it('should analyze a block and return worked jobs', async () => {
      const blockNumber = 1000;
      const jobAddresses = ['0x1234567890123456789012345678901234567890'];
      
      // Mock the RPC client response (our new implementation uses getBlockRange)
      const mockBlockRange = [
        {
          number: 1000,
          timestamp: 1640995200,
          transactions: ['0x1234567890123456789012345678901234567890'], // Already filtered work transactions
        }
      ];

      mockRpcClient.getBlockRange.mockResolvedValue(mockBlockRange);

      const result = await jobChecker.analyzeBlock(blockNumber, jobAddresses);

      expect(result).toEqual({
        blockNumber,
        workedJobs: ['0x1234567890123456789012345678901234567890'],
        timestamp: 1640995200,
      });
      expect(mockRpcClient.getBlockRange).toHaveBeenCalledWith(blockNumber, blockNumber);
    });

    it('should handle blocks with no job transactions', async () => {
      const blockNumber = 1001;
      const jobAddresses = ['0x1234567890123456789012345678901234567890'];
      
      // Mock RPC response with no work transactions (empty transactions array)
      const mockBlockRange = [
        {
          number: 1001,
          timestamp: 1640995300,
          transactions: [], // No work transactions found
        }
      ];

      mockRpcClient.getBlockRange.mockResolvedValue(mockBlockRange);

      const result = await jobChecker.analyzeBlock(blockNumber, jobAddresses);

      expect(result).toEqual({
        blockNumber,
        workedJobs: [],
        timestamp: 1640995300,
      });
      expect(mockRpcClient.getBlockRange).toHaveBeenCalledWith(blockNumber, blockNumber);
    });

    it('should handle block not found error', async () => {
      const blockNumber = 1002;
      const jobAddresses = ['0x1234567890123456789012345678901234567890'];

      // Mock RPC client to return empty array (block not found)
      mockRpcClient.getBlockRange.mockResolvedValue([]);

      const result = await jobChecker.analyzeBlock(blockNumber, jobAddresses);

      expect(result.blockNumber).toBe(blockNumber);
      expect(result.workedJobs).toEqual([]);
      expect(result.timestamp).toBeGreaterThan(0);
      expect(mockRpcClient.getBlockRange).toHaveBeenCalledWith(blockNumber, blockNumber);
    });
  });

  describe('analyzeBlocks', () => {
    it('should analyze multiple blocks using batch RPC', async () => {
      const jobAddresses = ['0x1234567890123456789012345678901234567890'];
      
      const mockBlocks = [
        {
          number: 1000,
          timestamp: 1640995200,
          transactions: ['0x1234567890123456789012345678901234567890'],
        },
        {
          number: 1001,
          timestamp: 1640995300,
          transactions: [],
        },
      ];

      mockRpcClient.getBlockRange.mockResolvedValue(mockBlocks);

      const results = await jobChecker.analyzeBlocks(1000, 1001, jobAddresses);

      expect(results).toHaveLength(2);
      expect(results[0].blockNumber).toBe(1000);
      expect(results[1].blockNumber).toBe(1001);
      expect(results[0].workedJobs).toEqual(['0x1234567890123456789012345678901234567890']);
      expect(results[1].workedJobs).toEqual([]);
      expect(mockRpcClient.getBlockRange).toHaveBeenCalledWith(1000, 1001);
    });
  });

  describe('determineStaleJobs', () => {
    it('should identify stale jobs correctly', () => {
      const jobAddresses = [
        '0x1234567890123456789012345678901234567890',
        '0x9876543210987654321098765432109876543210',
        '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      ];

      const blockResults: BlockAnalysisResult[] = [
        {
          blockNumber: 1000,
          workedJobs: ['0x1234567890123456789012345678901234567890'],
          timestamp: 1640995200,
        },
        {
          blockNumber: 1001,
          workedJobs: [],
          timestamp: 1640995300,
        },
        {
          blockNumber: 1002,
          workedJobs: ['0x9876543210987654321098765432109876543210'],
          timestamp: 1640995400,
        },
      ];

      const result = jobChecker.determineStaleJobs(jobAddresses, blockResults);

      expect(result).toHaveLength(3);
      
      const staleJob = result.find(job => 
        job.address === '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
      );
      expect(staleJob?.isStale).toBe(true);
      expect(staleJob?.lastWorkedBlock).toBeUndefined();

      const nonStaleJob1 = result.find(job => 
        job.address === '0x1234567890123456789012345678901234567890'
      );
      expect(nonStaleJob1?.isStale).toBe(false);
      expect(nonStaleJob1?.lastWorkedBlock).toBe(1000);

      const nonStaleJob2 = result.find(job => 
        job.address === '0x9876543210987654321098765432109876543210'
      );
      expect(nonStaleJob2?.isStale).toBe(false);
      expect(nonStaleJob2?.lastWorkedBlock).toBe(1002);
    });

    it('should handle empty block results', () => {
      const jobAddresses = ['0x1234567890123456789012345678901234567890'];
      const blockResults: BlockAnalysisResult[] = [];

      const result = jobChecker.determineStaleJobs(jobAddresses, blockResults);

      expect(result).toHaveLength(1);
      expect(result[0].isStale).toBe(true);
      expect(result[0].lastWorkedBlock).toBeUndefined();
    });
  });

  describe('checkJobWorkability', () => {
    it('should check job workability', async () => {
      const jobAddress = '0x1234567890123456789012345678901234567890';
      const network = '0x' + '1'.padStart(64, '0');

      // Mock ethers.Contract
      const mockContract = {
        workable: jest.fn().mockResolvedValue([true, '0x']),
      };

      (ethers.Contract as jest.Mock).mockImplementation(() => mockContract);

      const result = await jobChecker.checkJobWorkability(jobAddress, network);

      expect(result).toBe(true);
      expect(ethers.Contract).toHaveBeenCalledWith(
        jobAddress,
        ['function workable(bytes32) view returns (bool, bytes)'],
        mockProvider
      );
      expect(mockContract.workable).toHaveBeenCalledWith(network);
    });

    it('should handle workability check errors', async () => {
      const jobAddress = '0x1234567890123456789012345678901234567890';

      const mockContract = {
        workable: jest.fn().mockRejectedValue(new Error('Contract call failed')),
      };

      (ethers.Contract as jest.Mock).mockImplementation(() => mockContract);

      const result = await jobChecker.checkJobWorkability(jobAddress);

      expect(result).toBe(false);
    });
  });

  describe('performJobCheck', () => {
    it('should perform complete job check with optimized RPC calls', async () => {
      const jobAddresses = [
        '0x1234567890123456789012345678901234567890',
        '0x9876543210987654321098765432109876543210',
      ];

      mockRpcClient.getLatestBlockNumber.mockResolvedValue(1010);
      mockRpcClient.getBlockRange.mockResolvedValue([
        {
          number: 1006,
          timestamp: 1640995700,
          transactions: ['0x1234567890123456789012345678901234567890'],
        },
      ]);
      mockRpcClient.checkJobsWorkability.mockResolvedValue([
        { address: '0x9876543210987654321098765432109876543210', workable: true },
      ]);

      const result = await jobChecker.performJobCheck(jobAddresses, 10);

      expect(result.rpcCallsCount).toBe(3); // Optimized: 1 getLatestBlock + 1 getBlockRange + 1 checkWorkability
      expect(result.totalJobs).toBe(2);
      expect(result.staleJobs).toHaveLength(1);
      expect(result.staleJobs[0].address).toBe('0x9876543210987654321098765432109876543210');
      expect(result.staleJobs[0].workable).toBe(true);
      expect(result.lastAnalyzedBlock).toBe(1010);
    });
  });
});