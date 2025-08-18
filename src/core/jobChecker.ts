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