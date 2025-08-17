import { ethers } from 'ethers';
import fetch from 'node-fetch';
import { RpcBatchRequest, RpcBatchResponse } from '../types';
import { SEQUENCER_ABI } from '../abis/sequencer';
import { IJOB_ABI } from '../abis/ijob';

export class RpcClient {
  private requestId = 0;

  constructor(
    private readonly rpcUrl: string,
    private readonly provider: ethers.JsonRpcProvider
  ) {}

  public async batchCall(requests: RpcBatchRequest[]): Promise<RpcBatchResponse[]> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requests),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const results = await response.json() as RpcBatchResponse[];
      return Array.isArray(results) ? results : [results];
    } catch (error) {
      console.error('Batch RPC call failed:', error);
      throw error;
    }
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
              data: string;
            }>;
          };

          blocks.push({
            number: parseInt(block.number, 16),
            timestamp: parseInt(block.timestamp, 16),
            transactions: block.transactions
              .filter(tx => tx.to && tx.data)
              .map(tx => tx.to.toLowerCase()),
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
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json() as RpcBatchResponse;
      
      if (result.error) {
        throw new Error(`RPC error: ${result.error.message}`);
      }

      return parseInt(result.result as string, 16);
    } catch (error) {
      console.error('Error getting latest block number:', error);
      throw error;
    }
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
      });

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
      console.error('Error getting logs:', error);
      throw error;
    }
  }
}