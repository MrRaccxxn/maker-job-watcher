# 🏗️ MakerDAO Job Watcher

```
    🔍 👀 📊
   ╭─────────────╮
   │ 🏗️ MakerDAO │  ⚡ AWS Lambda Monitoring
   │   Job       │  🔔 Discord Alerts  
   │  Watcher    │  📈 CloudWatch Metrics
   ╰─────────────╯
        ⚙️ 🔄
```

AWS Lambda function that monitors MakerDAO jobs using the Sequencer contract and alerts when workable jobs are not being executed.

## Prerequisites

- Node.js >= 18.0.0
- [AWS CLI configured with appropriate permissions](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- [Serverless Framework (for deployment)](https://www.serverless.com/framework/docs/getting-started)

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```bash
# Required Variables
RPC_URL=https://your-ethereum-rpc-endpoint.com
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your-webhook-url
SEQUENCER_ADDRESS=0x238b4E35dAed6100C6162fAE4510261f88996EC9

# Optional Variables (with defaults)
BLOCKS_TO_ANALYZE=10
NETWORK=0x0000000000000000000000000000000000000000000000000000000000000001

# Grafana Cloud Logging (Optional)
GRAFANA_LOKI_URL=
GRAFANA_LOKI_USERNAME=
GRAFANA_LOKI_TOKEN=
```

## Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build
```

## Local Execution

### Method 1: Test Script (Recommended)
```bash
# Run the test script directly
npm run test:local

# Or run with auto-reload during development
npm run start:local
```

### Method 2: Manual Invocation
```bash
# Build and run
npm run dev
```

### Method 3: Direct Node Execution
```bash
# After building
node dist/scripts/test-local.js
```

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## AWS Deployment

### Setup Environment
```bash
# Make setup script executable and run
chmod +x scripts/setup-env.sh
./scripts/setup-env.sh
```

### Deploy to Different Stages
```bash
# Deploy to development
npm run deploy:dev

# Deploy to production
npm run deploy:prod

# Deploy using the enhanced script
npm run deploy

# Deploy to test environment
npm run deploy:test
```

### Deployment Management
```bash
# View deployment info
npm run info          # Production info
npm run info:dev      # Development info

# Remove deployment
npm run undeploy      # Remove production
npm run undeploy:dev  # Remove development
```

## Monitoring and Logs

### View Lambda Logs
```bash
# Tail production logs
npm run logs

# Tail development logs
npm run logs:dev
```

### Manual Invocation
```bash
# Invoke production function
npm run invoke

# Invoke development function
npm run invoke:dev

# Invoke with test data
npm run invoke:test
```

### HTTP Endpoints (if deployed)
```bash
# Manual scan trigger
GET https://your-api-gateway-url/scan

# Connectivity test
GET https://your-api-gateway-url/test

# Status check
GET https://your-api-gateway-url/status
```

## Grafana Logging Stack (Optional)

The project includes optional Grafana Cloud integration for enhanced logging and monitoring.

### Start Local Logging Stack
```bash
# Start Grafana, Loki, and Promtail
./start-logging-stack.sh

# Or use Docker Compose directly
docker-compose -f docker-compose.logging.yml up -d
```

### Access Grafana Dashboard
- URL: http://localhost:3000
- Login: admin/admin
- Pre-configured dashboards available in `grafana/dashboard.json`

## Project Structure

### Core Modules

#### `src/handler.ts`
Main Lambda entry point that:
- Validates environment variables and configuration
- Handles different event types (scheduled, test, status)
- Orchestrates the job scanning process
- Provides HTTP endpoint handlers

#### `src/services/jobScannerService.ts`
Core service responsible for:
- Fetching job addresses from Sequencer contract
- Coordinating job analysis and monitoring
- Publishing metrics to CloudWatch
- Sending Discord notifications

#### `src/core/jobChecker.ts`
Job analysis engine that:
- Analyzes blockchain blocks for job activity
- Determines which jobs are stale (not worked recently)
- Checks job workability status
- Optimizes RPC calls using batch operations

#### `src/integrations/`
External service integrations:
- **discord.ts**: Discord webhook notifications
- **rpc.ts**: Ethereum RPC client with batch operations
- **metrics.ts**: AWS CloudWatch metrics publishing
- **grafanaCloud.ts**: Grafana Cloud Loki logging
- **loki.ts**: Direct Loki log shipping

#### `src/types/index.ts`
TypeScript type definitions for:
- Job status and analysis results
- Discord alert structures
- Metrics data interfaces
- RPC batch request/response types

#### `src/utils/logger.ts`
Logging utilities with context management

### Configuration Files

- **serverless.yml**: AWS Lambda deployment configuration
- **package.json**: Dependencies and npm scripts
- **tsconfig.json**: TypeScript compilation settings
- **jest.config.js**: Test configuration

## How It Works

1. **Job Discovery**: Fetches all job addresses from the MakerDAO Sequencer contract
2. **Block Analysis**: Analyzes the last N blocks to identify which jobs were executed
3. **Stale Job Detection**: Identifies jobs that haven't been worked in the analyzed period
4. **Workability Check**: Verifies if stale jobs are actually workable (can be executed)
5. **Alerting**: Sends Discord notifications for workable stale jobs
6. **Metrics**: Publishes execution metrics to AWS CloudWatch

## Scheduled Execution

The Lambda function runs automatically:
- **Every 5 minutes**: Main job monitoring scan
- **Every hour**: Connectivity and health check

## Error Handling

- Comprehensive error logging to CloudWatch
- Discord error notifications for critical failures
- Graceful degradation when external services are unavailable
- Retry logic for RPC calls and external API requests