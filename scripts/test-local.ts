#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import { handler, httpHandler } from '../src/handler';
import { ScheduledEvent, Context, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// Load environment variables from .env file
dotenv.config();

interface LambdaResponse {
  statusCode: number;
  body: string;
}

// Mock Lambda context
const createMockContext = (): Context => ({
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'maker-job-watcher-local',
  functionVersion: '1',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:maker-job-watcher-local',
  memoryLimitInMB: '256',
  awsRequestId: `local-${Date.now()}`,
  logGroupName: '/aws/lambda/maker-job-watcher-local',
  logStreamName: `local-stream-${Date.now()}`,
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
});

// Mock scheduled event
const createScheduledEvent = (testMode = false, statusMode = false): ScheduledEvent => ({
  id: `local-event-${Date.now()}`,
  'detail-type': 'Scheduled Event',
  source: 'aws.events',
  account: '123456789012',
  time: new Date().toISOString(),
  region: 'us-east-1',
  detail: {},
  version: '0',
  resources: ['arn:aws:events:us-east-1:123456789012:rule/test-rule'],
  ...(testMode && { test: true }),
  ...(statusMode && { status: true }),
}) as ScheduledEvent & { test?: boolean; status?: boolean };

// Mock HTTP event
const createHttpEvent = (queryParams?: Record<string, string>): APIGatewayProxyEvent => ({
  httpMethod: 'GET',
  path: '/monitor',
  pathParameters: null,
  queryStringParameters: queryParams || null,
  headers: {
    'User-Agent': 'local-test',
  },
  multiValueHeaders: {},
  body: null,
  isBase64Encoded: false,
  stageVariables: null,
  requestContext: {
    accountId: '123456789012',
    apiId: 'local-api',
    httpMethod: 'GET',
    path: '/monitor',
    stage: 'local',
    requestId: `local-request-${Date.now()}`,
    requestTimeEpoch: Date.now(),
    resourceId: 'local-resource',
    resourcePath: '/monitor',
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
      userAgent: 'local-test',
      userArn: null,
      clientCert: null,
    },
    protocol: 'HTTP/1.1',
    requestTime: new Date().toISOString(),
  },
  resource: '/monitor',
  multiValueQueryStringParameters: null,
});

async function main(): Promise<void> {
  console.log('🚀 Starting Local MakerDAO Job Watcher Test\n');

  // Check environment variables
  const requiredEnvVars = ['RPC_URL', 'DISCORD_WEBHOOK_URL', 'SEQUENCER_ADDRESS'];
  const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(envVar => console.error(`   - ${envVar}`));
    console.error('\n💡 Please set these variables in your .env file or environment');
    console.error('   Example: export RPC_URL="https://eth-mainnet.alchemyapi.io/v2/your-key"');
    process.exit(1);
  }

  console.log('✅ Environment variables configured\n');

  const context = createMockContext();

  // Test 1: Connectivity Test
  console.log('🔌 Testing connectivity...');
  try {
    const testEvent = createScheduledEvent(true, false);
    const result = await handler(testEvent, context, undefined as never) as LambdaResponse;
    console.log('✅ Connectivity Test Result:', JSON.parse(result.body));
  } catch (error) {
    console.error('❌ Connectivity Test Failed:', error);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 2: Status Check
  console.log('📊 Testing status check...');
  try {
    const statusEvent = createScheduledEvent(false, true);
    const result = await handler(statusEvent, context, undefined as never) as LambdaResponse;
    console.log('✅ Status Check Result:', JSON.parse(result.body));
  } catch (error) {
    console.error('❌ Status Check Failed:', error);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 3: Full Job Scan
  console.log('🔍 Testing full job scan...');
  try {
    const scanEvent = createScheduledEvent(false, false);
    const result = await handler(scanEvent, context, undefined as never) as LambdaResponse;
    console.log('✅ Job Scan Result:', JSON.parse(result.body));
  } catch (error) {
    console.error('❌ Job Scan Failed:', error);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 4: HTTP Handler
  console.log('🌐 Testing HTTP handler...');
  try {
    const httpEvent = createHttpEvent({ test: 'true' });
    const result = await httpHandler(httpEvent, context, undefined as never) as APIGatewayProxyResult;
    console.log('✅ HTTP Handler Result:', JSON.parse(result.body));
  } catch (error) {
    console.error('❌ HTTP Handler Failed:', error);
  }

  console.log('\n🎉 Local testing completed!');
}

// Handle command line arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: npm run test:local [options]

Options:
  --help, -h     Show this help message

Environment Variables Required:
  RPC_URL                    Ethereum RPC endpoint URL
  DISCORD_WEBHOOK_URL        Discord webhook URL
  SEQUENCER_ADDRESS          MakerDAO Sequencer contract address

Optional Environment Variables:
  BLOCKS_TO_ANALYZE          Number of blocks to analyze (default: 10)
  NETWORK                    Network identifier (default: mainnet)

Examples:
  npm run test:local
  RPC_URL=https://mainnet.infura.io/v3/key npm run test:local
`);
  process.exit(0);
}

main().catch(error => {
  console.error('💥 Local test failed:', error);
  process.exit(1);
});