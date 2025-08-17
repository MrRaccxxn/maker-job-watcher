#!/bin/bash

echo "🚀 MakerDAO Job Watcher - Production Deployment"
echo "=============================================="

# Check if environment is specified
STAGE=${1:-prod}
echo "Deploying to stage: $STAGE"

# Check prerequisites
echo ""
echo "🔍 Checking prerequisites..."

# Check if AWS CLI is configured
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "❌ AWS CLI not configured. Run 'aws configure' first."
    exit 1
fi
echo "✅ AWS CLI configured"

# Check if Serverless Framework is installed
if ! command -v serverless &> /dev/null; then
    echo "❌ Serverless Framework not installed. Install with: npm install -g serverless"
    exit 1
fi
echo "✅ Serverless Framework installed"

# Check if required environment variables are set
if [ ! -f ".env.production" ]; then
    echo "❌ .env.production file not found. Create it with your production configuration."
    exit 1
fi
echo "✅ Production environment file found"

# Load environment variables for validation
set -a
source .env.production
set +a

# Validate critical environment variables
if [ -z "$RPC_URL" ] || [ -z "$DISCORD_WEBHOOK_URL" ] || [ -z "$SEQUENCER_ADDRESS" ]; then
    echo "❌ Missing critical environment variables in .env.production"
    echo "Required: RPC_URL, DISCORD_WEBHOOK_URL, SEQUENCER_ADDRESS"
    exit 1
fi
echo "✅ Environment variables validated"

# Build the project
echo ""
echo "🔨 Building TypeScript..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi
echo "✅ Build successful"

# Deploy using Serverless Framework
echo ""
echo "🚀 Deploying to AWS..."
serverless deploy --stage $STAGE --verbose

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Deployment successful!"
    echo ""
    echo "📊 Resources created:"
    echo "   - Lambda Function: maker-job-watcher-$STAGE-job-watcher"
    echo "   - EventBridge Rule: maker-job-watcher-$STAGE-schedule"
    echo "   - CloudWatch Log Groups: /aws/lambda/maker-job-watcher-$STAGE-*"
    echo "   - HTTP API: Check output above for endpoint URL"
    echo ""
    echo "🔍 Monitoring:"
    echo "   - CloudWatch Logs: https://console.aws.amazon.com/cloudwatch/home#logs:"
    echo "   - Grafana Cloud: Check your Grafana dashboard for logs"
    echo ""
    echo "🧪 Testing:"
    echo "   - Manual trigger: aws lambda invoke --function-name maker-job-watcher-$STAGE-job-watcher --payload '{}' response.json"
    echo "   - HTTP endpoint: curl [HTTP_API_ENDPOINT]/scan"
    
else
    echo "❌ Deployment failed"
    exit 1
fi