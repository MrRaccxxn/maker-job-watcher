import { ScheduledEvent, Context, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler, httpHandler } from '../src/handler';
import { JobScannerService } from '../src/services/jobScannerService';

interface LambdaResponse {
  statusCode: number;
  body: string;
}

jest.mock('../src/services/jobScannerService');
jest.mock('../src/utils/logger', () => ({
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

describe('Lambda Handler', () => {
  let mockJobScannerService: jest.Mocked<JobScannerService>;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  
  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-function',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '256',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/test-function',
    logStreamName: '2023/01/01/test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: jest.fn(),
    fail: jest.fn(),
    succeed: jest.fn(),
  };

  const mockScheduledEvent: ScheduledEvent = {
    id: 'test-event-id',
    'detail-type': 'Scheduled Event',
    source: 'aws.events',
    account: '123456789012',
    time: '2023-01-01T12:00:00Z',
    region: 'us-east-1',
    detail: {},
    version: '0',
    resources: ['arn:aws:events:us-east-1:123456789012:rule/test-rule'],
  };

  interface ExtendedScheduledEvent extends ScheduledEvent {
    test?: boolean;
    status?: boolean;
    testMode?: boolean;
    statusCheck?: boolean;
  }

  beforeEach(() => {
    // Suppress console output during tests to reduce noise
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    
    mockJobScannerService = {
      scanJobs: jest.fn(),
      testConnectivity: jest.fn(),
      getJobsStatus: jest.fn(),
    } as unknown as jest.Mocked<JobScannerService>;

    (JobScannerService as jest.Mock).mockImplementation(() => mockJobScannerService);

    // Set required environment variables
    process.env.RPC_URL = 'https://test-rpc.com';
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/webhook';
    process.env.SEQUENCER_ADDRESS = '0x1234567890123456789012345678901234567890';
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    delete process.env.RPC_URL;
    delete process.env.DISCORD_WEBHOOK_URL;
    delete process.env.SEQUENCER_ADDRESS;
    delete process.env.BLOCKS_TO_ANALYZE;
    delete process.env.NETWORK;
  });

  describe('handler', () => {
    it('should successfully scan jobs', async () => {
      const mockScanResult = {
        success: true,
        result: {
          totalJobs: 5,
          staleJobs: [
            {
              address: '0xjob1',
              workable: true,
              isStale: true,
            },
          ],
          lastAnalyzedBlock: 1000,
          rpcCallsCount: 15,
        },
        metrics: {
          jobsNotWorkedCount: 1,
          rpcFailures: 0,
          alertsSent: 1,
          executionDuration: 2500,
        },
      };

      mockJobScannerService.scanJobs.mockResolvedValue(mockScanResult);

      const result = await handler(mockScheduledEvent, mockContext, undefined as never) as LambdaResponse;

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({
        success: true,
        totalJobs: 5,
        staleJobsFound: 1,
        lastAnalyzedBlock: 1000,
        rpcCallsCount: 15,
        executionDuration: 2500,
        alertsSent: 1,
      });
    });

    it('should handle job scan failure', async () => {
      const mockScanResult = {
        success: false,
        error: 'RPC connection failed',
        metrics: {
          jobsNotWorkedCount: 0,
          rpcFailures: 1,
          alertsSent: 0,
          executionDuration: 1000,
        },
      };

      mockJobScannerService.scanJobs.mockResolvedValue(mockScanResult);

      const result = await handler(mockScheduledEvent, mockContext, undefined as never) as LambdaResponse;

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        success: false,
        error: 'RPC connection failed',
        executionDuration: 1000,
      });
    });

    it('should handle missing environment variables', async () => {
      delete process.env.RPC_URL;

      const result = await handler(mockScheduledEvent, mockContext, undefined as never) as LambdaResponse;

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        success: false,
        error: 'Missing required environment variables: RPC_URL',
      });
    });

    it('should validate invalid RPC URL format', async () => {
      process.env.RPC_URL = 'invalid-url';

      const result = await handler(mockScheduledEvent, mockContext, undefined as never) as LambdaResponse;

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        success: false,
        error: expect.stringContaining('Invalid RPC URL format'),
      });
    });

    it('should validate invalid Ethereum address format', async () => {
      process.env.SEQUENCER_ADDRESS = 'invalid-address';

      const result = await handler(mockScheduledEvent, mockContext, undefined as never) as LambdaResponse;

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        success: false,
        error: expect.stringContaining('Invalid Sequencer address format'),
      });
    });

    it('should validate invalid BLOCKS_TO_ANALYZE value', async () => {
      process.env.BLOCKS_TO_ANALYZE = '200';

      const result = await handler(mockScheduledEvent, mockContext, undefined as never) as LambdaResponse;

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        success: false,
        error: expect.stringContaining('Invalid BLOCKS_TO_ANALYZE value'),
      });
    });

    it('should validate invalid network format', async () => {
      process.env.NETWORK = 'invalid-network';

      const result = await handler(mockScheduledEvent, mockContext, undefined as never) as LambdaResponse;

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        success: false,
        error: expect.stringContaining('Invalid network format'),
      });
    });

    it('should handle test events', async () => {
      const testEvent: ExtendedScheduledEvent = {
        ...mockScheduledEvent,
        test: true,
      };

      const mockConnectivity = {
        rpcConnected: true,
        discordConnected: true,
        metricsConnected: true,
        sequencerAccessible: true,
      };

      mockJobScannerService.testConnectivity.mockResolvedValue(mockConnectivity);

      const result = await handler(testEvent, mockContext, undefined as never) as LambdaResponse;

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({
        success: true,
        connectivity: mockConnectivity,
        message: 'All systems operational',
      });
    });

    it('should handle test events with connectivity issues', async () => {
      const testEvent: ExtendedScheduledEvent = {
        ...mockScheduledEvent,
        test: true,
      };

      const mockConnectivity = {
        rpcConnected: false,
        discordConnected: true,
        metricsConnected: true,
        sequencerAccessible: false,
      };

      mockJobScannerService.testConnectivity.mockResolvedValue(mockConnectivity);

      const result = await handler(testEvent, mockContext, undefined as never) as LambdaResponse;

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        success: false,
        connectivity: mockConnectivity,
        message: 'Some systems not accessible',
      });
    });

    it('should handle status events', async () => {
      const statusEvent: ExtendedScheduledEvent = {
        ...mockScheduledEvent,
        status: true,
      };

      const mockStatus = {
        totalJobs: 10,
        jobAddresses: ['0xjob1', '0xjob2'],
        currentBlock: 1500,
      };

      mockJobScannerService.getJobsStatus.mockResolvedValue(mockStatus);

      const result = await handler(statusEvent, mockContext, undefined as never) as LambdaResponse;

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({
        success: true,
        totalJobs: 10,
        jobAddresses: ['0xjob1', '0xjob2'],
        currentBlock: 1500,
      });
    });

    it('should handle unexpected errors', async () => {
      mockJobScannerService.scanJobs.mockRejectedValue(new Error('Unexpected error'));

      const result = await handler(mockScheduledEvent, mockContext, undefined as never) as LambdaResponse;

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        success: false,
        error: 'Unexpected error',
      });
    });

    it('should use environment variable configuration', async () => {
      process.env.BLOCKS_TO_ANALYZE = '15';
      process.env.NETWORK = '0x' + '2'.padStart(64, '0');

      mockJobScannerService.scanJobs.mockResolvedValue({
        success: true,
        result: {
          totalJobs: 0,
          staleJobs: [],
          lastAnalyzedBlock: 1000,
          rpcCallsCount: 1,
        },
        metrics: {
          jobsNotWorkedCount: 0,
          rpcFailures: 0,
          alertsSent: 0,
          executionDuration: 500,
        },
      });

      await handler(mockScheduledEvent, mockContext, undefined as never);

      expect(JobScannerService).toHaveBeenCalledWith({
        rpcUrl: 'https://test-rpc.com',
        discordWebhookUrl: 'https://discord.com/webhook',
        sequencerAddress: '0x1234567890123456789012345678901234567890',
        blocksToAnalyze: 15,
        network: '0x' + '2'.padStart(64, '0'),
      });
    });
  });

  describe('httpHandler', () => {
    const createMockHttpEvent = (
      queryStringParameters?: { [key: string]: string } | null
    ): APIGatewayProxyEvent => ({
      httpMethod: 'GET',
      path: '/test',
      pathParameters: null,
      queryStringParameters: queryStringParameters || null,
      headers: {},
      multiValueHeaders: {},
      body: null,
      isBase64Encoded: false,
      stageVariables: null,
      requestContext: {
        accountId: '123456789012',
        apiId: 'test-api',
        httpMethod: 'GET',
        path: '/test',
        stage: 'test',
        requestId: 'test-request',
        requestTimeEpoch: 1640995200000,
        resourceId: 'test-resource',
        resourcePath: '/test',
        authorizer: {},
        identity: {
          accessKey: null,
          accountId: null,
          apiKey: null,
          apiKeyId: null,
          caller: null,
          cognitoAuthenticationProvider: null,
          cognitoAuthenticationType: null,
          cognitoIdentityId: null,
          cognitoIdentityPoolId: null,
          principalOrgId: null,
          sourceIp: '127.0.0.1',
          user: null,
          userAgent: 'test-agent',
          userArn: null,
          clientCert: null,
        },
        protocol: 'HTTP/1.1',
        requestTime: '01/Jan/2022:00:00:00 +0000',
      },
      resource: '/test',
      multiValueQueryStringParameters: null,
    });

    it('should handle HTTP requests and convert to scheduled events', async () => {
      const httpEvent = createMockHttpEvent({ test: 'true' });

      mockJobScannerService.testConnectivity.mockResolvedValue({
        rpcConnected: true,
        discordConnected: true,
        metricsConnected: true,
        sequencerAccessible: true,
      });

      const result = await httpHandler(httpEvent, mockContext, undefined as never) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      expect(result.headers).toMatchObject({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
    });

    it('should handle status query parameter', async () => {
      const httpEvent = createMockHttpEvent({ status: 'true' });

      mockJobScannerService.getJobsStatus.mockResolvedValue({
        totalJobs: 5,
        jobAddresses: ['0xjob1'],
        currentBlock: 1000,
      });

      const result = await httpHandler(httpEvent, mockContext, undefined as never) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.totalJobs).toBe(5);
    });

    it('should handle HTTP handler errors', async () => {
      const httpEvent = createMockHttpEvent({ test: 'true' });
      
      // Mock context with invalid ARN
      const invalidContext = {
        ...mockContext,
        invokedFunctionArn: 'invalid-arn',
      };

      const result = await httpHandler(httpEvent, invalidContext, undefined as never) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(500);
      expect(result.headers).toMatchObject({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid function ARN format');
    });

    it('should handle null query parameters', async () => {
      const httpEvent = createMockHttpEvent(null);

      mockJobScannerService.scanJobs.mockResolvedValue({
        success: true,
        result: {
          totalJobs: 0,
          staleJobs: [],
          lastAnalyzedBlock: 1000,
          rpcCallsCount: 1,
        },
        metrics: {
          jobsNotWorkedCount: 0,
          rpcFailures: 0,
          alertsSent: 0,
          executionDuration: 500,
        },
      });

      const result = await httpHandler(httpEvent, mockContext, undefined as never) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
    });
  });
});