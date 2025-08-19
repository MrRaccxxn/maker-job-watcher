import { ethers } from 'ethers';
import fetch from 'node-fetch';
import { Agent } from 'https';
import { RpcBatchRequest, RpcBatchResponse } from '../types';
import { SEQUENCER_ABI } from '../abis/sequencer';
import { IJOB_ABI } from '../abis/ijob';

interface RpcConfig {
  timeout: number;
  maxRetries: number;
  baseRetryDelay: number;
  maxRetryDelay: number;
  rateLimit: {
    requestsPerSecond: number;
    burstLimit: number;
  };
}

export class RpcClient {
  private requestId = 0;
  private readonly config: RpcConfig;
  private readonly httpAgent: Agent;
  private lastRequestTime = 0;

  // TODO: Add support for multiple RPC provider URLs with automatic failover (Switch to other RPC providers if one fails)

  constructor(
    private readonly rpcUrl: string,
    private readonly provider: ethers.JsonRpcProvider,
    config?: Partial<RpcConfig>
  ) {
    this.config = {
      timeout: 30000, // 30 seconds
      maxRetries: 3,
      baseRetryDelay: 1000, // 1 second
      maxRetryDelay: 10000, // 10 seconds
      rateLimit: {
        requestsPerSecond: 10,
        burstLimit: 20
      },
      ...config
    };

    // HTTP connection pooling for better performance
    this.httpAgent = new Agent({
      keepAlive: true,
      maxSockets: 10,
      maxFreeSockets: 5,
      timeout: this.config.timeout,
      keepAliveMsecs: 30000
    });
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minInterval = 1000 / this.config.rateLimit.requestsPerSecond;

    if (timeSinceLastRequest < minInterval) {
      await this.sleep(minInterval - timeSinceLastRequest);
    }

    this.lastRequestTime = Date.now();
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        await this.waitForRateLimit();
        return await operation();
      } catch (error: unknown) {
        lastError = error as Error;
        
        if (attempt === this.config.maxRetries - 1) {
          console.error(`${context} failed after ${this.config.maxRetries} attempts:`, lastError);
          throw lastError;
        }

        const delay = Math.min(
          this.config.baseRetryDelay * Math.pow(2, attempt),
          this.config.maxRetryDelay
        );
        
        console.warn(`${context} attempt ${attempt + 1} failed, retrying in ${delay}ms:`, lastError.message);
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  public async batchCall(requests: RpcBatchRequest[]): Promise<RpcBatchResponse[]> {
    return this.retryWithBackoff(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      try {
        const response = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requests),
          agent: this.httpAgent,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const results = await response.json() as RpcBatchResponse[];
        return Array.isArray(results) ? results : [results];
      } catch (error) {
        clearTimeout(timeoutId);
        if ((error as Error).name === 'AbortError') {
          throw new Error(`Request timeout after ${this.config.timeout}ms`);
        }
        throw error;
      }
    }, 'Batch RPC call');
  }

  public async getJobAddresses(sequencerAddress: string): Promise<string[]> {
    const contract = new ethers.Contract(sequencerAddress, SEQUENCER_ABI, this.provider);
    
    try {
      // Get total number of jobs
      const numJobs = await contract.numJobs() as bigint;
      const jobCount = Number(numJobs);
      
      if (jobCount === 0) {
        return [];
      }

      // Create batch requests for all job addresses
      const requests: RpcBatchRequest[] = [];
      
      for (let i = 0; i < jobCount; i++) {
        const calldata = contract.interface.encodeFunctionData('jobAt', [i]);
        requests.push({
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [
            {
              to: sequencerAddress,
              data: calldata,
            },
            'latest',
          ],
          id: ++this.requestId,
        });
      }

      const responses = await this.batchCall(requests);
      const jobAddresses: string[] = [];

      for (const response of responses) {
        if (response.error) {
          console.error(`RPC error for request ${response.id}:`, response.error);
          continue;
        }

        if (response.result) {
          try {
            const decoded = contract.interface.decodeFunctionResult('jobAt', response.result as string);
            jobAddresses.push(decoded[0] as string);
          } catch (error) {
            console.error('Error decoding jobAt result:', error);
          }
        }
      }

      return jobAddresses;
    } catch (error) {
      console.error('Error getting job addresses:', error);
      throw error;
    }
  }

  public async checkJobsWorkability(
    jobAddresses: string[],
    network: string = '0x' + '1'.padStart(64, '0')
  ): Promise<Array<{ address: string; workable: boolean }>> {
    if (jobAddresses.length === 0) {
      return [];
    }

    const requests: RpcBatchRequest[] = [];
    
    // Create batch requests for workable() calls
    for (const jobAddress of jobAddresses) {
      const iface = new ethers.Interface(IJOB_ABI);
      const calldata = iface.encodeFunctionData('workable', [network]);
      
      requests.push({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
          {
            to: jobAddress,
            data: calldata,
          },
          'latest',
        ],
        id: ++this.requestId,
      });
    }

    try {
      const responses = await this.batchCall(requests);
      const results: Array<{ address: string; workable: boolean }> = [];
      
      for (let i = 0; i < responses.length; i++) {
        const response = responses[i];
        const jobAddress = jobAddresses[i];
        
        if (response.error) {
          console.error(`RPC error for job ${jobAddress}:`, response.error);
          results.push({ address: jobAddress, workable: false });
          continue;
        }

        if (response.result) {
          try {
            const iface = new ethers.Interface(IJOB_ABI);
            const decoded = iface.decodeFunctionResult('workable', response.result as string);
            const canWork = decoded[0] as boolean;
            results.push({ address: jobAddress, workable: canWork });
          } catch (error) {
            console.error(`Error decoding workable result for ${jobAddress}:`, error);
            results.push({ address: jobAddress, workable: false });
          }
        } else {
          results.push({ address: jobAddress, workable: false });
        }
      }

      return results;
    } catch (error) {
      console.error('Error checking jobs workability:', error);
      throw error;
    }
  }

  /**
   * Get work transactions using eth_getLogs (most efficient for small ranges)
   */
  public async getWorkTransactionsByLogs(
    jobAddresses: string[],
    fromBlock: number,
    toBlock: number
  ): Promise<Array<{
    number: number;
    timestamp: number;
    transactions: string[];
  }>> {
    const maxBlockRange = 500; // RPC provider limit
    const blockRange = toBlock - fromBlock + 1;
    
    if (blockRange > maxBlockRange) {
      throw new Error(`Block range ${blockRange} exceeds maximum ${maxBlockRange} for eth_getLogs`);
    }

    console.log(`Using eth_getLogs for ${blockRange} blocks (${fromBlock} to ${toBlock})...`);

    try {
      // Get logs from all job addresses in one call
      const logs = await this.provider.getLogs({
        address: jobAddresses,
        fromBlock: fromBlock,
        toBlock: toBlock,
        // No topics filter - get all events from job contracts
      });

      console.log(`Found ${logs.length} events from job contracts`);

      // Group by block number and filter for actual work events
      const blockMap = new Map<number, Set<string>>();
      const verifiedTransactions = new Set<string>();

      // First pass: collect unique transaction hashes for verification
      const txHashes = [...new Set(logs.map(log => log.transactionHash))];
      
      // Batch verify transactions are work() calls
      for (const txHash of txHashes) {
        const tx = await this.provider.getTransaction(txHash);
        if (tx && tx.data.toLowerCase().startsWith('0x1d2ab000')) {
          verifiedTransactions.add(txHash);
        }
      }

      // Second pass: group verified work transactions by block
      for (const log of logs) {
        if (verifiedTransactions.has(log.transactionHash)) {
          const blockNumber = log.blockNumber;
          if (!blockMap.has(blockNumber)) {
            blockMap.set(blockNumber, new Set());
          }
          blockMap.get(blockNumber)!.add(log.address.toLowerCase());
        }
      }

      // Convert to expected format
      const results: Array<{
        number: number;
        timestamp: number;
        transactions: string[];
      }> = [];
      
      for (const [blockNumber, addresses] of blockMap.entries()) {
        results.push({
          number: blockNumber,
          timestamp: 0, // Not needed for current use case
          transactions: Array.from(addresses)
        });
      }

      console.log(`Detected ${results.length} blocks with work transactions using eth_getLogs`);
      return results;

    } catch (error) {
      console.error('eth_getLogs failed:', error);
      throw error;
    }
  }

  public async getBlockRange(startBlock: number, endBlock: number): Promise<Array<{
    number: number;
    timestamp: number;
    transactions: string[];
  }>> {
    const requests: RpcBatchRequest[] = [];
    
    for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
      requests.push({
        jsonrpc: '2.0',
        method: 'eth_getBlockByNumber',
        params: [`0x${blockNumber.toString(16)}`, true],
        id: ++this.requestId,
      });
    }

    try {
      const responses = await this.batchCall(requests);
      const blocks: Array<{
        number: number;
        timestamp: number;
        transactions: string[];
      }> = [];

      for (const response of responses) {
        if (response.error) {
          console.error(`RPC error for block request ${response.id}:`, response.error);
          continue;
        }

        if (response.result) {
          const block = response.result as {
            number: string;
            timestamp: string;
            transactions: Array<{
              to: string;
              data?: string;
              input?: string;
            }>;
          };

          // Filter for work() method calls to job addresses
          // work() method signature is 0x1d2ab000 for work(bytes32,bytes)
          const workedJobAddresses = block.transactions
            .filter(tx => {
              const txData = tx.input || tx.data;
              return tx.to && 
                     txData && 
                     txData.toLowerCase().startsWith('0x1d2ab000');
            })
            .map(tx => tx.to.toLowerCase());

          blocks.push({
            number: parseInt(block.number, 16),
            timestamp: parseInt(block.timestamp, 16),
            transactions: workedJobAddresses,
          });
        }
      }

      return blocks.sort((a, b) => a.number - b.number);
    } catch (error) {
      console.error('Error getting block range:', error);
      throw error;
    }
  }

  public async getLatestBlockNumber(): Promise<number> {
    return this.retryWithBackoff(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      try {
        const response = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_blockNumber',
            params: [],
            id: ++this.requestId,
          }),
          agent: this.httpAgent,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json() as RpcBatchResponse;
        
        if (result.error) {
          throw new Error(`RPC error: ${result.error.message}`);
        }

        return parseInt(result.result as string, 16);
      } catch (error) {
        clearTimeout(timeoutId);
        if ((error as Error).name === 'AbortError') {
          throw new Error(`Request timeout after ${this.config.timeout}ms`);
        }
        throw error;
      }
    }, 'Get latest block number');
  }

  public async getLogs(
    address: string,
    fromBlock: number,
    toBlock: number,
    topics?: string[]
  ): Promise<Array<{
    address: string;
    blockNumber: number;
    transactionHash: string;
    topics: string[];
    data: string;
  }>> {
    return this.retryWithBackoff(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      try {
        const response = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_getLogs',
            params: [
              {
                address,
                fromBlock: `0x${fromBlock.toString(16)}`,
                toBlock: `0x${toBlock.toString(16)}`,
                topics,
              },
            ],
            id: ++this.requestId,
          }),
          agent: this.httpAgent,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json() as RpcBatchResponse;
        
        if (result.error) {
          throw new Error(`RPC error: ${result.error.message}`);
        }

        const logs = result.result as Array<{
          address: string;
          blockNumber: string;
          transactionHash: string;
          topics: string[];
          data: string;
        }>;

        return logs.map(log => ({
          address: log.address,
          blockNumber: parseInt(log.blockNumber, 16),
          transactionHash: log.transactionHash,
          topics: log.topics,
          data: log.data,
        }));
      } catch (error) {
        clearTimeout(timeoutId);
        if ((error as Error).name === 'AbortError') {
          throw new Error(`Request timeout after ${this.config.timeout}ms`);
        }
        throw error;
      }
    }, 'Get logs');
  }

  public cleanup(): void {
    this.httpAgent.destroy();
  }
}