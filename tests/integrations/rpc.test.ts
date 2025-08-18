import fetch from 'node-fetch';
import { ethers } from 'ethers';
import { RpcClient } from '../../src/integrations/rpc';
import { RpcBatchRequest, RpcBatchResponse } from '../../src/types';

jest.mock('node-fetch');
jest.mock('ethers');

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('RpcClient', () => {
  let rpcClient: RpcClient;
  let mockProvider: jest.Mocked<ethers.JsonRpcProvider>;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockProvider = {} as jest.Mocked<ethers.JsonRpcProvider>;
    rpcClient = new RpcClient('https://test-rpc.com', mockProvider);
    
    // Suppress console output during error tests to reduce noise
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('batchCall', () => {
    it('should make successful batch RPC calls', async () => {
      const requests: RpcBatchRequest[] = [
        {
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1,
        },
        {
          jsonrpc: '2.0',
          method: 'eth_getBlockByNumber',
          params: ['latest', false],
          id: 2,
        },
      ];

      const mockResponse: RpcBatchResponse[] = [
        {
          jsonrpc: '2.0',
          id: 1,
          result: '0x1234',
        },
        {
          jsonrpc: '2.0',
          id: 2,
          result: { number: '0x1234', timestamp: '0x5678' },
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);

      const result = await rpcClient.batchCall(requests);

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith('https://test-rpc.com', expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requests),
      }));
    });

    it('should handle HTTP errors', async () => {
      const requests: RpcBatchRequest[] = [{
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }];

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      } as any);

      await expect(rpcClient.batchCall(requests)).rejects.toThrow('HTTP error! status: 500');
    });

    it('should handle single response as array', async () => {
      const requests: RpcBatchRequest[] = [{
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }];

      const mockResponse: RpcBatchResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: '0x1234',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);

      const result = await rpcClient.batchCall(requests);

      expect(result).toEqual([mockResponse]);
    });
  });

  describe('getJobAddresses', () => {
    it('should get job addresses from sequencer contract', async () => {
      const sequencerAddress = '0x1234567890123456789012345678901234567890';
      
      const mockContract = {
        numJobs: jest.fn().mockResolvedValue(BigInt(2)),
        interface: {
          encodeFunctionData: jest.fn()
            .mockReturnValueOnce('0xencoded1')
            .mockReturnValueOnce('0xencoded2'),
          decodeFunctionResult: jest.fn()
            .mockReturnValueOnce(['0xjob1'])
            .mockReturnValueOnce(['0xjob2']),
        },
      };

      (ethers.Contract as jest.Mock).mockImplementation(() => mockContract);

      const mockResponses: RpcBatchResponse[] = [
        {
          jsonrpc: '2.0',
          id: 1,
          result: '0xresult1',
        },
        {
          jsonrpc: '2.0',
          id: 2,
          result: '0xresult2',
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponses),
      } as any);

      const result = await rpcClient.getJobAddresses(sequencerAddress);

      expect(result).toEqual(['0xjob1', '0xjob2']);
      expect(mockContract.numJobs).toHaveBeenCalled();
    });

    it('should handle zero jobs', async () => {
      const sequencerAddress = '0x1234567890123456789012345678901234567890';
      
      const mockContract = {
        numJobs: jest.fn().mockResolvedValue(BigInt(0)),
      };

      (ethers.Contract as jest.Mock).mockImplementation(() => mockContract);

      const result = await rpcClient.getJobAddresses(sequencerAddress);

      expect(result).toEqual([]);
    });

    it('should handle RPC errors in batch response', async () => {
      const sequencerAddress = '0x1234567890123456789012345678901234567890';
      
      const mockContract = {
        numJobs: jest.fn().mockResolvedValue(BigInt(1)),
        interface: {
          encodeFunctionData: jest.fn().mockReturnValue('0xencoded'),
          decodeFunctionResult: jest.fn(),
        },
      };

      (ethers.Contract as jest.Mock).mockImplementation(() => mockContract);

      const mockResponses: RpcBatchResponse[] = [
        {
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32000,
            message: 'execution reverted',
          },
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponses),
      } as any);

      const result = await rpcClient.getJobAddresses(sequencerAddress);

      expect(result).toEqual([]);
    });
  });

  describe('checkJobsWorkability', () => {
    it('should check workability for multiple jobs', async () => {
      const jobAddresses = ['0xjob1', '0xjob2'];
      const network = '0x' + '1'.padStart(64, '0');

      const mockInterface = {
        encodeFunctionData: jest.fn().mockReturnValue('0xencoded'),
        decodeFunctionResult: jest.fn()
          .mockReturnValueOnce([true])
          .mockReturnValueOnce([false]),
      };

      (ethers.Interface as unknown as jest.Mock).mockImplementation(() => mockInterface);

      const mockResponses: RpcBatchResponse[] = [
        {
          jsonrpc: '2.0',
          id: 1,
          result: '0xresult1',
        },
        {
          jsonrpc: '2.0',
          id: 2,
          result: '0xresult2',
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponses),
      } as any);

      const result = await rpcClient.checkJobsWorkability(jobAddresses, network);

      expect(result).toEqual([
        { address: '0xjob1', workable: true },
        { address: '0xjob2', workable: false },
      ]);
    });

    it('should handle empty job addresses array', async () => {
      const result = await rpcClient.checkJobsWorkability([]);
      expect(result).toEqual([]);
    });
  });

  describe('getLatestBlockNumber', () => {
    it('should get latest block number', async () => {
      const mockResponse: RpcBatchResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: '0x1234',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);

      const result = await rpcClient.getLatestBlockNumber();

      expect(result).toBe(0x1234);
    });

    it('should handle RPC errors', async () => {
      const mockResponse: RpcBatchResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32000,
          message: 'Internal error',
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);

      await expect(rpcClient.getLatestBlockNumber()).rejects.toThrow('RPC error: Internal error');
    });
  });

  describe('getLogs', () => {
    it('should get logs for address and block range', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const fromBlock = 1000;
      const toBlock = 1010;

      const mockResponse: RpcBatchResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: [
          {
            address: '0x1234567890123456789012345678901234567890',
            blockNumber: '0x3e8',
            transactionHash: '0xhash1',
            topics: ['0xtopic1'],
            data: '0xdata1',
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);

      const result = await rpcClient.getLogs(address, fromBlock, toBlock);

      expect(result).toEqual([
        {
          address: '0x1234567890123456789012345678901234567890',
          blockNumber: 1000,
          transactionHash: '0xhash1',
          topics: ['0xtopic1'],
          data: '0xdata1',
        },
      ]);
    });
  });
});