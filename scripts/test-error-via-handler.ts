#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import { handler } from '../src/handler';
import { ScheduledEvent, Context } from 'aws-lambda';

// Load environment variables
dotenv.config();

// Mock Lambda context
const createMockContext = (): Context => ({
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'maker-job-watcher-error-test',
  functionVersion: '1',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:maker-job-watcher-error-test',
  memoryLimitInMB: '256',
  awsRequestId: `error-test-${Date.now()}`,
  logGroupName: '/aws/lambda/maker-job-watcher-error-test',
  logStreamName: `error-test-stream-${Date.now()}`,
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
});

// Create an event that will cause an error
const createErrorEvent = (): ScheduledEvent => ({
  id: `error-event-${Date.now()}`,
  'detail-type': 'Scheduled Event',
  source: 'aws.events',
  account: '123456789012',
  time: new Date().toISOString(),
  region: 'us-east-1',
  detail: {},
  version: '0',
  resources: ['arn:aws:events:us-east-1:123456789012:rule/error-test-rule'],
});

async function testErrorViaHandler(): Promise<void> {
  console.log('🔥 Testing Error Logs via Handler\n');

  const context = createMockContext();

  // Test 1: Missing environment variables (will cause error)
  console.log('💥 Test 1: Simulating missing environment variables...');
  
  // Backup current env vars
  const backupEnv = {
    RPC_URL: process.env.RPC_URL,
    DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
    SEQUENCER_ADDRESS: process.env.SEQUENCER_ADDRESS,
  };

  // Temporarily remove required env vars to trigger error
  delete process.env.RPC_URL;
  
  try {
    const errorEvent = createErrorEvent();
    const result = await handler(errorEvent, context, undefined as never);
    if (result && 'body' in result) {
      console.log('❌ Expected error but got result:', JSON.parse(result.body));
    } else {
      console.log('❌ Unexpected result type:', result);
    }
  } catch (error) {
    console.log('✅ Got expected error:', error instanceof Error ? error.message : 'Unknown error');
  }

  // Restore env vars
  Object.assign(process.env, backupEnv);

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 2: Invalid RPC URL (will cause error)
  console.log('🌐 Test 2: Testing with invalid RPC URL...');
  
  // Backup and set invalid RPC URL
  const originalRpcUrl = process.env.RPC_URL;
  process.env.RPC_URL = 'invalid-url-not-http';

  try {
    const errorEvent = createErrorEvent();
    const result = await handler(errorEvent, context, undefined as never);
    if (result && 'body' in result) {
      console.log('Result with invalid RPC:', JSON.parse(result.body));
    } else {
      console.log('Unexpected result type:', result);
    }
  } catch (error) {
    console.log('✅ Got expected error for invalid RPC:', error instanceof Error ? error.message : 'Unknown error');
  }

  // Restore original RPC URL
  process.env.RPC_URL = originalRpcUrl;

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 3: Invalid contract address
  console.log('📝 Test 3: Testing with invalid contract address...');
  
  const originalAddress = process.env.SEQUENCER_ADDRESS;
  process.env.SEQUENCER_ADDRESS = 'invalid-address';

  try {
    const errorEvent = createErrorEvent();
    const result = await handler(errorEvent, context, undefined as never);
    if (result && 'body' in result) {
      console.log('Result with invalid address:', JSON.parse(result.body));
    } else {
      console.log('Unexpected result type:', result);
    }
  } catch (error) {
    console.log('✅ Got expected error for invalid address:', error instanceof Error ? error.message : 'Unknown error');
  }

  // Restore original address
  process.env.SEQUENCER_ADDRESS = originalAddress;

  console.log('\n✅ Error testing via handler completed!');
  console.log('📊 Check Grafana dashboard for ERROR level logs');
  console.log('🔍 These errors should appear in the same log stream as normal operations');
  
  // Wait for logs to be written
  await new Promise(resolve => setTimeout(resolve, 2000));
}

// Main execution
if (require.main === module) {
  testErrorViaHandler().catch(error => {
    console.error('💥 Error test script failed:', error);
    process.exit(1);
  });
}

export { testErrorViaHandler };