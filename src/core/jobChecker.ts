import { ethers } from 'ethers';
import { JobStatus, BlockAnalysisResult, JobCheckResult } from '../types';
import { RpcClient } from '../integrations/rpc';

export class JobChecker {
  constructor(
    private readonly provider: ethers.JsonRpcProvider,
    private readonly rpcClient: RpcClient
  ) {}

  public async analyzeBlocks(
    startBlock: number,
    endBlock: number,
    jobAddresses: string[]
  ): Promise<BlockAnalysisResult[]> {
    // Use batch RPC call to get all blocks at once
    const blocks = await this.rpcClient.getBlockRange(startBlock, endBlock);
    const results: BlockAnalysisResult[] = [];
    
    // Normalize job addresses for comparison
    const normalizedJobAddresses = jobAddresses.map(addr => addr.toLowerCase());
    
    for (const block of blocks) {
      const workedJobs = new Set<string>();
      
      // Check if any transactions are to our job addresses
      for (const txTo of block.transactions) {
        if (normalizedJobAddresses.includes(txTo)) {
          // For now, assume any transaction to a job address is a work transaction
          // In practice, you'd want to decode the transaction data to verify it's calling work()
          workedJobs.add(txTo);
        }
      }
      
      results.push({
        blockNumber: block.number,
        workedJobs: Array.from(workedJobs),
        timestamp: block.timestamp,
      });
    }
    
    return results.sort((a, b) => a.blockNumber - b.blockNumber);
  }

  public async analyzeBlock(
    blockNumber: number,
    jobAddresses: string[]
  ): Promise<BlockAnalysisResult> {
    try {
      const blocks = await this.rpcClient.getBlockRange(blockNumber, blockNumber);
      
      if (blocks.length === 0) {
        throw new Error(`Block ${blockNumber} not found`);
      }

      const block = blocks[0];
      const workedJobs = new Set<string>();

      for (const jobAddress of block.transactions) {
        if (jobAddresses.some(addr => addr.toLowerCase() === jobAddress)) {
          workedJobs.add(jobAddress);
        }
      }

      return {
        blockNumber,
        workedJobs: Array.from(workedJobs),
        timestamp: block.timestamp,
      };
    } catch (error) {
      console.error(`Error analyzing block ${blockNumber}:`, error);
      return {
        blockNumber,
        workedJobs: [],
        timestamp: Date.now() / 1000,
      };
    }
  }

  public determineStaleJobs(
    jobAddresses: string[],
    blockResults: BlockAnalysisResult[]
  ): JobStatus[] {
    const jobStatuses: JobStatus[] = [];
    
    for (const jobAddress of jobAddresses) {
      const normalizedAddress = jobAddress.toLowerCase();
      
      // Find the most recent block where this job was worked
      let lastWorkedBlock: number | undefined;
      
      for (let i = blockResults.length - 1; i >= 0; i--) {
        if (blockResults[i].workedJobs.includes(normalizedAddress)) {
          lastWorkedBlock = blockResults[i].blockNumber;
          break;
        }
      }
      
      // Consider a job stale if it wasn't worked in any of the analyzed blocks
      const isStale = lastWorkedBlock === undefined;
      
      jobStatuses.push({
        address: jobAddress,
        workable: false, // Will be determined by RPC call
        lastWorkedBlock,
        isStale,
      });
    }
    
    return jobStatuses;
  }

  public async checkJobWorkability(
    jobAddress: string,
    network: string = '0x' + '1'.padStart(64, '0') // Default to mainnet
  ): Promise<boolean> {
    try {
      // Create contract instance for the job
      const contract = new ethers.Contract(
        jobAddress,
        ['function workable(bytes32) view returns (bool, bytes)'],
        this.provider
      );
      
      const [canWork] = await contract.workable(network) as [boolean, string];
      return canWork;
    } catch (error) {
      console.error(`Error checking workability for job ${jobAddress}:`, error);
      return false;
    }
  }

  public async checkIfAnyJobsWorkedOptimized(
    jobAddresses: string[],
    blocksToAnalyze: number = 10
  ): Promise<{
    totalWorkTransactions: number;
    lastAnalyzedBlock: number;
    rpcCallsCount: number;
    method: 'eth_getLogs' | 'getBlockRange' | 'chunked';
  }> {
    const latestBlockNumber = await this.provider.getBlockNumber();
    const startBlock = latestBlockNumber - blocksToAnalyze + 1;
    const endBlock = latestBlockNumber;

    console.log(`Checking if any jobs worked in blocks ${startBlock} to ${endBlock}...`);

    let rpcCallsUsed = 1; // For getBlockNumber()
    let method: 'eth_getLogs' | 'getBlockRange' | 'chunked';
    let blocks: Array<{ number: number; timestamp: number; transactions: string[] }>;

    try {
      // Choose optimal method based on block range size
      if (blocksToAnalyze <= 500) {
        // Use eth_getLogs for small ranges (most efficient)
        console.log(`Using eth_getLogs optimization for ${blocksToAnalyze} blocks`);
        method = 'eth_getLogs';
        blocks = await this.rpcClient.getWorkTransactionsByLogs(jobAddresses, startBlock, endBlock);
        rpcCallsUsed += 1; // eth_getLogs call + transaction verification calls
        // Add transaction verification RPC calls (approximate)
        rpcCallsUsed += Math.min(blocks.length * 2, 50); // Max 50 additional calls for tx verification
      } else if (blocksToAnalyze <= 1000) {
        // Use original method for medium ranges
        console.log(`Using getBlockRange method for ${blocksToAnalyze} blocks`);
        method = 'getBlockRange';
        blocks = await this.rpcClient.getBlockRange(startBlock, endBlock);
        rpcCallsUsed += 1; // Single batch call
      } else {
        // Use chunked approach for large ranges
        console.log(`Using chunked approach for ${blocksToAnalyze} blocks`);
        method = 'chunked';
        const chunkSize = 500;
        blocks = [];
        
        for (let start = startBlock; start <= endBlock; start += chunkSize) {
          const chunkEnd = Math.min(start + chunkSize - 1, endBlock);
          const chunkBlocks = await this.rpcClient.getWorkTransactionsByLogs(jobAddresses, start, chunkEnd);
          blocks.push(...chunkBlocks);
          rpcCallsUsed += 1;
          
          // Add delay between chunks to respect rate limits
          if (start + chunkSize <= endBlock) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }

      // Count total work transactions across all blocks
      const totalWorkTransactions = blocks.reduce((sum, block) => sum + block.transactions.length, 0);

      return {
        totalWorkTransactions,
        lastAnalyzedBlock: endBlock,
        rpcCallsCount: rpcCallsUsed,
        method
      };

    } catch (error) {
      console.error('Error in optimized job check:', error);
      
      // Fallback to original method
      console.log('Falling back to original getBlockRange method...');
      const fallbackBlocks = await this.rpcClient.getBlockRange(startBlock, endBlock);
      const totalWorkTransactions = fallbackBlocks.reduce((sum, block) => sum + block.transactions.length, 0);
      
      return {
        totalWorkTransactions,
        lastAnalyzedBlock: endBlock,
        rpcCallsCount: rpcCallsUsed + 1,
        method: 'getBlockRange'
      };
    }
  }

  public async checkIfAnyJobsWorked(
    jobAddresses: string[],
    blocksToAnalyze: number = 10
  ): Promise<{
    totalWorkTransactions: number;
    lastAnalyzedBlock: number;
    rpcCallsCount: number;
  }> {
    let rpcCallsCount = 0;

    try {
      // Get the latest block number
      const latestBlock = await this.provider.getBlockNumber();
      rpcCallsCount++;

      const startBlock = latestBlock - blocksToAnalyze + 1;
      const endBlock = latestBlock;

      console.log(`Checking if any jobs worked in blocks ${startBlock} to ${endBlock}...`);

      // Get all blocks in the range and count work transactions
      const blocks = await this.rpcClient.getBlockRange(startBlock, endBlock);
      rpcCallsCount++;

      let totalWorkTransactions = 0;

      for (const block of blocks) {
        const workedJobs = block.transactions
          .filter((tx: any) => {
            const txData = tx.input || tx.data;
            return tx.to && txData && txData.toLowerCase().startsWith('0x1d2ab000');
          })
          .map((tx: any) => tx.to!.toLowerCase())
          .filter((address: string) => jobAddresses.some(job => job.toLowerCase() === address));

        totalWorkTransactions += workedJobs.length;
      }

      console.log(`Found ${totalWorkTransactions} work transactions in ${blocksToAnalyze} blocks`);

      return {
        totalWorkTransactions,
        lastAnalyzedBlock: latestBlock,
        rpcCallsCount,
      };
    } catch (error) {
      console.error('Error checking job work activity:', error);
      throw error;
    }
  }

  public async performJobCheck(
    jobAddresses: string[],
    blocksToAnalyze: number = 10
  ): Promise<JobCheckResult> {
    let rpcCallsCount = 0;
    
    // Get latest block number (1 RPC call)
    const latestBlock = await this.rpcClient.getLatestBlockNumber();
    rpcCallsCount++;
    
    const startBlock = Math.max(1, latestBlock - blocksToAnalyze + 1);
    
    // Analyze the last N blocks (1 batch RPC call for all blocks)
    const blockResults = await this.analyzeBlocks(startBlock, latestBlock, jobAddresses);
    rpcCallsCount++; // Single batch call for all blocks
    
    // Determine which jobs are stale
    const jobStatuses = this.determineStaleJobs(jobAddresses, blockResults);
    
    // Get stale job addresses for batch workability check
    const staleJobAddresses = jobStatuses
      .filter(job => job.isStale)
      .map(job => job.address);
    
    if (staleJobAddresses.length > 0) {
      // Batch check workability for all stale jobs (1 batch RPC call)
      const workabilityResults = await this.rpcClient.checkJobsWorkability(staleJobAddresses);
      rpcCallsCount++;
      
      // Create map for quick lookup
      const workabilityMap = new Map(
        workabilityResults.map(result => [result.address.toLowerCase(), result.workable])
      );
      
      // Update job statuses with workability
      for (const jobStatus of jobStatuses) {
        if (jobStatus.isStale) {
          jobStatus.workable = workabilityMap.get(jobStatus.address.toLowerCase()) || false;
        }
      }
    }
    
    const staleJobs = jobStatuses.filter(job => job.isStale);
    
    return {
      totalJobs: jobAddresses.length,
      staleJobs: staleJobs.filter(job => job.workable), // Only include workable stale jobs
      lastAnalyzedBlock: latestBlock,
      rpcCallsCount,
    };
  }

}