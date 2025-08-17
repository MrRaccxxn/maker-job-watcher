import { Handler, ScheduledEvent, Context, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { JobScannerService, JobScannerConfig } from './services/jobScannerService';

interface LambdaResponse {
  statusCode: number;
  body: string;
}

interface ExtendedScheduledEvent extends ScheduledEvent {
  test?: boolean;
  status?: boolean;
  testMode?: boolean;
  statusCheck?: boolean;
}

interface HttpEvent {
  httpMethod?: string;
  path?: string;
  queryStringParameters?: { [key: string]: string | undefined } | null;
  body?: string | null;
}

interface EnvironmentVariables {
  RPC_URL?: string;
  DISCORD_WEBHOOK_URL?: string;
  SEQUENCER_ADDRESS?: string;
  BLOCKS_TO_ANALYZE?: string;
  NETWORK?: string;
}

// Type guards for robust validation
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function isValidHexString(hex: string, length?: number): boolean {
  const regex = length ? new RegExp(`^0x[a-fA-F0-9]{${length}}$`) : /^0x[a-fA-F0-9]+$/;
  return regex.test(hex);
}

function validateConfiguration(
  rpcUrl: string,
  discordWebhookUrl: string,
  sequencerAddress: string,
  blocksToAnalyze: number,
  network: string
): string | null {
  if (!isValidUrl(rpcUrl)) {
    return `Invalid RPC URL format: ${rpcUrl}`;
  }

  if (!isValidUrl(discordWebhookUrl)) {
    return `Invalid Discord webhook URL format`;
  }

  if (!isValidEthereumAddress(sequencerAddress)) {
    return `Invalid Sequencer address format: ${sequencerAddress}`;
  }

  if (blocksToAnalyze < 1 || blocksToAnalyze > 100) {
    return `Invalid blocks to analyze: ${blocksToAnalyze}. Must be between 1 and 100.`;
  }

  if (!isValidHexString(network, 64)) {
    return `Invalid network format: ${network}. Must be a 64-character hex string.`;
  }

  return null;
}

export const handler: Handler<ScheduledEvent | ExtendedScheduledEvent, LambdaResponse> = async (
  event: ScheduledEvent | ExtendedScheduledEvent,
  context: Context
): Promise<LambdaResponse> => {
  console.log('MakerDAO Job Watcher Lambda started');
  console.log('Event:', JSON.stringify(event, null, 2));
  console.log('Context:', JSON.stringify(context, null, 2));

  // Validate required environment variables with proper typing
  const env = process.env as EnvironmentVariables;
  const requiredEnvVars: (keyof EnvironmentVariables)[] = ['RPC_URL', 'DISCORD_WEBHOOK_URL', 'SEQUENCER_ADDRESS'];
  const missingEnvVars = requiredEnvVars.filter(envVar => !env[envVar]);

  if (missingEnvVars.length > 0) {
    const errorMessage = `Missing required environment variables: ${missingEnvVars.join(', ')}`;
    console.error(errorMessage);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  // Type-safe environment variable validation
  const rpcUrl = env.RPC_URL;
  const discordWebhookUrl = env.DISCORD_WEBHOOK_URL;
  const sequencerAddress = env.SEQUENCER_ADDRESS;

  if (!rpcUrl || !discordWebhookUrl || !sequencerAddress) {
    const errorMessage = 'Required environment variables are not properly set';
    console.error(errorMessage);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  // Parse and validate optional environment variables
  let blocksToAnalyze = 10;
  if (env.BLOCKS_TO_ANALYZE) {
    const parsed = parseInt(env.BLOCKS_TO_ANALYZE, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 100) {
      const errorMessage = `Invalid BLOCKS_TO_ANALYZE value: ${env.BLOCKS_TO_ANALYZE}. Must be a number between 1 and 100.`;
      console.error(errorMessage);
      
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        }),
      };
    }
    blocksToAnalyze = parsed;
  }

  // Set network with proper default
  const network = env.NETWORK || '0x' + '1'.padStart(64, '0'); // Default to mainnet

  // Validate configuration before creating config object
  const configError = validateConfiguration(
    rpcUrl,
    discordWebhookUrl,
    sequencerAddress,
    blocksToAnalyze,
    network
  );
  
  if (configError) {
    console.error('Configuration validation failed:', configError);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: configError,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  // Initialize the job scanner service with validated configuration
  const config: JobScannerConfig = {
    rpcUrl,
    discordWebhookUrl,
    sequencerAddress,
    blocksToAnalyze,
    network,
  };

  console.log('Configuration:', {
    rpcUrl: config.rpcUrl.substring(0, 50) + '...',
    sequencerAddress: config.sequencerAddress,
    blocksToAnalyze: config.blocksToAnalyze,
    network: config.network,
    discordConfigured: !!config.discordWebhookUrl,
  });

  const jobScanner = new JobScannerService(config);

  try {
    // Handle different event sources
    if (isTestEvent(event)) {
      console.log('Test event detected, running connectivity tests...');
      return await handleTestEvent(jobScanner);
    }

    if (isStatusEvent(event)) {
      console.log('Status event detected, returning job status...');
      return await handleStatusEvent(jobScanner);
    }

    // Default behavior: scan for stale jobs
    console.log('Running scheduled job scan...');
    const result = await jobScanner.scanJobs();

    if (result.success && result.result) {
      const summary = {
        success: true,
        totalJobs: result.result.totalJobs,
        staleJobsFound: result.result.staleJobs.length,
        lastAnalyzedBlock: result.result.lastAnalyzedBlock,
        rpcCallsCount: result.result.rpcCallsCount,
        executionDuration: result.metrics.executionDuration,
        alertsSent: result.metrics.alertsSent,
        timestamp: new Date().toISOString(),
      };

      console.log('Job scan completed successfully:', summary);

      return {
        statusCode: 200,
        body: JSON.stringify(summary),
      };
    } else {
      console.error('Job scan failed:', result.error);

      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: result.error,
          executionDuration: result.metrics.executionDuration,
          timestamp: new Date().toISOString(),
        }),
      };
    }

  } catch (error) {
    console.error('Unexpected error in Lambda handler:', error);

    // Send error notification to Discord
    try {
      if (config.discordWebhookUrl) {
        const { DiscordNotifier } = await import('./integrations/discord');
        const discord = new DiscordNotifier(config.discordWebhookUrl);
        await discord.sendErrorAlert(
          error instanceof Error ? error : new Error('Unknown error'),
          'Lambda Handler'
        );
      }
    } catch (discordError) {
      console.error('Failed to send Discord error notification:', discordError);
    }

    const errorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    };

    return {
      statusCode: 500,
      body: JSON.stringify(errorResponse),
    };
  }
};

async function handleTestEvent(jobScanner: JobScannerService): Promise<LambdaResponse> {
  try {
    const connectivity = await jobScanner.testConnectivity();
    
    const allConnected = Object.values(connectivity).every(connected => connected);
    
    const response = {
      success: allConnected,
      connectivity,
      message: allConnected ? 'All systems operational' : 'Some systems not accessible',
      timestamp: new Date().toISOString(),
    };

    console.log('Connectivity test results:', response);

    return {
      statusCode: allConnected ? 200 : 500,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Test event failed:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Test failed',
        timestamp: new Date().toISOString(),
      }),
    };
  }
}

async function handleStatusEvent(jobScanner: JobScannerService): Promise<LambdaResponse> {
  try {
    const status = await jobScanner.getJobsStatus();
    
    const response = {
      success: true,
      ...status,
      timestamp: new Date().toISOString(),
    };

    console.log('Status retrieved successfully:', {
      totalJobs: status.totalJobs,
      currentBlock: status.currentBlock,
    });

    return {
      statusCode: 200,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Status event failed:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Status retrieval failed',
        timestamp: new Date().toISOString(),
      }),
    };
  }
}

function isTestEvent(event: ScheduledEvent | ExtendedScheduledEvent): event is ExtendedScheduledEvent {
  // Type-safe check for test event
  const extendedEvent = event as ExtendedScheduledEvent;
  return extendedEvent.test === true ||
         (event.source === 'aws.events' && extendedEvent.testMode === true);
}

function isStatusEvent(event: ScheduledEvent | ExtendedScheduledEvent): event is ExtendedScheduledEvent {
  // Type-safe check for status event
  const extendedEvent = event as ExtendedScheduledEvent;
  return extendedEvent.status === true ||
         (event.source === 'aws.events' && extendedEvent.statusCheck === true);
}

// Additional handler for HTTP API Gateway events (if needed for manual triggers)
export const httpHandler: Handler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('HTTP handler invoked');
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Type-safe extraction of HTTP event properties
    const httpEvent: HttpEvent = {
      httpMethod: event.httpMethod,
      path: event.path,
      queryStringParameters: event.queryStringParameters,
      body: event.body,
    };

    // Validate context properties exist
    if (!context.awsRequestId || !context.invokedFunctionArn) {
      throw new Error('Invalid Lambda context provided');
    }

    const arnParts = context.invokedFunctionArn.split(':');
    if (arnParts.length < 5) {
      throw new Error('Invalid function ARN format');
    }

    // Convert HTTP event to scheduled event format with proper typing
    const scheduledEvent: ExtendedScheduledEvent = {
      id: context.awsRequestId,
      'detail-type': 'Scheduled Event',
      source: 'aws.apigateway',
      account: arnParts[4],
      time: new Date().toISOString(),
      region: arnParts[3],
      detail: {},
      version: '0',
      resources: [context.invokedFunctionArn],
    };

    // Add test or status flags based on query parameters with null safety
    const queryParams = httpEvent.queryStringParameters;
    if (queryParams?.test === 'true') {
      scheduledEvent.test = true;
    }

    if (queryParams?.status === 'true') {
      scheduledEvent.status = true;
    }

    const result = await handler(scheduledEvent, context, undefined as never) as LambdaResponse;

    // Return HTTP-compatible response
    return {
      statusCode: result.statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: result.body,
    };
  } catch (error) {
    console.error('HTTP handler error:', error);
    
    const errorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'HTTP handler failed',
      timestamp: new Date().toISOString(),
    };

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(errorResponse),
    };
  }
};