export interface JobStatus {
  address: string;
  workable: boolean;
  lastWorkedBlock?: number;
  isStale: boolean;
}

export interface BlockAnalysisResult {
  blockNumber: number;
  workedJobs: string[];
  timestamp: number;
}

export interface JobCheckResult {
  totalJobs: number;
  staleJobs: JobStatus[];
  lastAnalyzedBlock: number;
  rpcCallsCount: number;
}

export interface DiscordAlert {
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    fields: Array<{
      name: string;
      value: string;
      inline?: boolean;
    }>;
    timestamp: string;
  }>;
}

export interface MetricsData {
  jobsNotWorkedCount: number;
  rpcFailures: number;
  alertsSent: number;
  executionDuration: number;
}

export interface WorkableJob {
  job: string;
  canWork: boolean;
  args: string;
}

export interface RpcBatchRequest {
  jsonrpc: string;
  method: string;
  params: unknown[];
  id: number;
}

export interface RpcBatchResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}