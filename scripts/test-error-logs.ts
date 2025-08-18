#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import { EnhancedLogger } from '../src/utils/logger';
import { DiscordNotifier } from '../src/integrations/discord';

// Load environment variables
dotenv.config();

async function testErrorLogs(): Promise<void> {
  console.log('🔥 Testing Error Log Generation\n');

  // Initialize enhanced logger with the same service name as the main app
  const logger = new EnhancedLogger('maker-job-watcher');
  
  // Add context to identify these as test logs
  logger.setContext({
    executionId: `error-test-${Date.now()}`,
    environment: 'local',
    functionName: 'error-test',
    testMode: true
  });

  // Test 1: Generate various error levels
  console.log('📝 Generating different log levels...');
  
  logger.info('Test session started', { sessionId: 'error-test-001' });
  logger.warn('This is a warning message', { component: 'test-component' });
  logger.error('This is an ERROR message for testing', { 
    errorCode: 'TEST_001',
    component: 'error-generator',
    details: 'Simulated error for log testing'
  });

  // Test 2: Simulate RPC connection error
  console.log('🔗 Simulating RPC connection error...');
  
  logger.error('RPC connection failed', {
    rpcUrl: 'https://fake-rpc-endpoint.com',
    errorType: 'CONNECTION_TIMEOUT',
    retryAttempt: 3,
    component: 'rpc-client'
  });

  // Test 3: Simulate job monitoring error
  console.log('⚡ Simulating job monitoring error...');
  
  logger.error('Failed to check job status', {
    jobAddress: '0x1234567890123456789012345678901234567890',
    errorType: 'CONTRACT_CALL_FAILED',
    blockNumber: 19000000,
    component: 'job-checker'
  });

  // Test 4: Send Discord error alert (if webhook is configured)
  if (process.env.DISCORD_WEBHOOK_URL) {
    console.log('📨 Testing Discord error alert...');
    
    try {
      const discord = new DiscordNotifier(process.env.DISCORD_WEBHOOK_URL);
      const testError = new Error('Test error for Discord notification');
      testError.stack = `Error: Test error for Discord notification
    at testErrorLogs (/scripts/test-error-logs.ts:55:25)
    at Object.<anonymous> (/scripts/test-error-logs.ts:80:1)`;
      
      await discord.sendErrorAlert(testError, 'Error Log Test');
      console.log('✅ Discord error alert sent successfully');
    } catch (error) {
      logger.error('Failed to send Discord error alert', {
        error: error instanceof Error ? error.message : 'Unknown error',
        component: 'discord-notifier'
      });
    }
  } else {
    console.log('⚠️  DISCORD_WEBHOOK_URL not configured, skipping Discord test');
  }

  // Test 5: Generate structured error with stack trace
  console.log('📚 Generating error with stack trace...');
  
  try {
    // Simulate a function that throws an error
    function problematicFunction() {
      throw new Error('Database connection lost');
    }
    
    problematicFunction();
  } catch (error) {
    logger.error('Caught exception in error test', {
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      stackTrace: error instanceof Error ? error.stack : undefined,
      component: 'error-simulator',
      timestamp: new Date().toISOString()
    });
  }

  // Test 6: Generate multiple rapid errors
  console.log('🌪️  Generating rapid error sequence...');
  
  for (let i = 1; i <= 5; i++) {
    logger.error(`Rapid error sequence ${i}/5`, {
      sequenceNumber: i,
      errorType: 'RAPID_ERROR_TEST',
      component: 'bulk-error-generator'
    });
    
    // Small delay to make logs distinguishable
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('\n✅ Error log generation completed!');
  console.log('📊 Check Grafana dashboard for new ERROR level logs');
  console.log('🔍 Look for logs with level="ERROR" in the time range');
  
  // Wait a bit for logs to be written
  await new Promise(resolve => setTimeout(resolve, 1000));
}

// Main execution
if (require.main === module) {
  testErrorLogs().catch(error => {
    console.error('💥 Error test script failed:', error);
    process.exit(1);
  });
}

export { testErrorLogs };