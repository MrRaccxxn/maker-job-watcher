#!/bin/bash

# MakerDAO Job Watcher Deployment Script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
STAGE="dev"
REGION="us-east-1"
STACK_NAME=""
BUILD_ONLY=false
VALIDATE_ONLY=false

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -s, --stage STAGE          Deployment stage (dev, staging, prod) [default: dev]"
    echo "  -r, --region REGION        AWS region [default: us-east-1]"
    echo "  -n, --stack-name NAME      CloudFormation stack name [default: maker-job-watcher-STAGE]"
    echo "  -b, --build-only           Only build the project, don't deploy"
    echo "  -v, --validate-only        Only validate the template, don't deploy"
    echo "  -h, --help                 Show this help message"
    echo ""
    echo "Environment Variables (required for deployment):"
    echo "  RPC_URL                    Ethereum RPC endpoint URL"
    echo "  DISCORD_WEBHOOK_URL        Discord webhook URL"
    echo "  SEQUENCER_ADDRESS          MakerDAO Sequencer contract address"
    echo "  BLOCKS_TO_ANALYZE          Number of blocks to analyze (optional, default: 10)"
    echo "  NETWORK                    Network identifier (optional, default: mainnet)"
    echo ""
    echo "Examples:"
    echo "  $0 --stage prod --region us-west-2"
    echo "  $0 --build-only"
    echo "  $0 --validate-only"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--stage)
            STAGE="$2"
            shift 2
            ;;
        -r|--region)
            REGION="$2"
            shift 2
            ;;
        -n|--stack-name)
            STACK_NAME="$2"
            shift 2
            ;;
        -b|--build-only)
            BUILD_ONLY=true
            shift
            ;;
        -v|--validate-only)
            VALIDATE_ONLY=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Set default stack name if not provided
if [ -z "$STACK_NAME" ]; then
    STACK_NAME="maker-job-watcher-$STAGE"
fi

# Validate stage
if [[ ! "$STAGE" =~ ^(dev|staging|prod)$ ]]; then
    print_error "Invalid stage: $STAGE. Must be one of: dev, staging, prod"
    exit 1
fi

print_status "Starting deployment process..."
print_status "Stage: $STAGE"
print_status "Region: $REGION"
print_status "Stack Name: $STACK_NAME"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if SAM CLI is installed
if ! command -v sam &> /dev/null; then
    print_warning "SAM CLI is not installed. Falling back to manual deployment."
    USE_SAM=false
else
    USE_SAM=true
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS credentials are not configured. Please run 'aws configure'."
    exit 1
fi

print_success "AWS credentials validated"

# Install dependencies
print_status "Installing dependencies..."
if ! npm ci; then
    print_error "Failed to install dependencies"
    exit 1
fi

print_success "Dependencies installed"

# Run linting
print_status "Running linter..."
if ! npm run lint; then
    print_error "Linting failed. Please fix the issues before deploying."
    exit 1
fi

print_success "Linting passed"

# Run tests
print_status "Running tests..."
if ! npm test; then
    print_error "Tests failed. Please fix the issues before deploying."
    exit 1
fi

print_success "Tests passed"

# Build the project
print_status "Building project..."
if ! npm run build; then
    print_error "Build failed"
    exit 1
fi

print_success "Project built successfully"

# If build-only flag is set, exit here
if [ "$BUILD_ONLY" = true ]; then
    print_success "Build completed. Exiting as requested."
    exit 0
fi

# Validate template
print_status "Validating CloudFormation template..."
if ! aws cloudformation validate-template --template-body file://template.yaml --region "$REGION" &> /dev/null; then
    print_error "Template validation failed"
    exit 1
fi

print_success "Template validation passed"

# If validate-only flag is set, exit here
if [ "$VALIDATE_ONLY" = true ]; then
    print_success "Template validation completed. Exiting as requested."
    exit 0
fi

# Check required environment variables for deployment
REQUIRED_VARS=("RPC_URL" "DISCORD_WEBHOOK_URL" "SEQUENCER_ADDRESS")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    print_error "Missing required environment variables:"
    for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
    done
    echo ""
    echo "Please set these variables before deploying:"
    echo "  export RPC_URL='https://your-rpc-endpoint'"
    echo "  export DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/...'"
    echo "  export SEQUENCER_ADDRESS='0x...'"
    exit 1
fi

print_success "Required environment variables are set"

# Prepare deployment parameters
PARAMETERS="ParameterKey=RpcUrl,ParameterValue=$RPC_URL"
PARAMETERS="$PARAMETERS ParameterKey=DiscordWebhookUrl,ParameterValue=$DISCORD_WEBHOOK_URL"
PARAMETERS="$PARAMETERS ParameterKey=SequencerAddress,ParameterValue=$SEQUENCER_ADDRESS"
PARAMETERS="$PARAMETERS ParameterKey=Stage,ParameterValue=$STAGE"

# Add optional parameters if set
if [ -n "$BLOCKS_TO_ANALYZE" ]; then
    PARAMETERS="$PARAMETERS ParameterKey=BlocksToAnalyze,ParameterValue=$BLOCKS_TO_ANALYZE"
fi

if [ -n "$NETWORK" ]; then
    PARAMETERS="$PARAMETERS ParameterKey=Network,ParameterValue=$NETWORK"
fi

# Deploy using SAM or CloudFormation
if [ "$USE_SAM" = true ]; then
    print_status "Deploying using SAM CLI..."
    
    # Create SAM configuration if it doesn't exist
    if [ ! -f "samconfig.toml" ]; then
        print_status "Creating SAM configuration..."
        cat > samconfig.toml << EOF
version = 0.1
[default]
[default.deploy]
[default.deploy.parameters]
stack_name = "$STACK_NAME"
s3_bucket = ""
s3_prefix = "maker-job-watcher"
region = "$REGION"
capabilities = "CAPABILITY_IAM"
parameter_overrides = "$PARAMETERS"
confirm_changeset = false
EOF
    fi
    
    # Deploy with SAM
    if ! sam build && sam deploy --region "$REGION" --stack-name "$STACK_NAME" --parameter-overrides $PARAMETERS --capabilities CAPABILITY_IAM --no-confirm-changeset; then
        print_error "SAM deployment failed"
        exit 1
    fi
else
    print_status "Deploying using CloudFormation..."
    
    # Package the Lambda function
    print_status "Packaging Lambda function..."
    cd dist && zip -r ../function.zip . && cd ..
    
    # Create S3 bucket for deployment artifacts if it doesn't exist
    BUCKET_NAME="maker-job-watcher-deploy-$STAGE-$(date +%s)"
    if ! aws s3 mb "s3://$BUCKET_NAME" --region "$REGION" 2>/dev/null; then
        print_warning "Could not create S3 bucket. Using existing bucket or falling back to local deployment."
    else
        # Upload function package to S3
        aws s3 cp function.zip "s3://$BUCKET_NAME/function.zip" --region "$REGION"
        
        # Update template to reference S3 object
        sed -i.bak "s|CodeUri: dist/|CodeUri: s3://$BUCKET_NAME/function.zip|g" template.yaml
    fi
    
    # Deploy CloudFormation stack
    if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" &>/dev/null; then
        print_status "Updating existing stack..."
        OPERATION="update-stack"
    else
        print_status "Creating new stack..."
        OPERATION="create-stack"
    fi
    
    if ! aws cloudformation $OPERATION \
        --stack-name "$STACK_NAME" \
        --template-body file://template.yaml \
        --parameters $PARAMETERS \
        --capabilities CAPABILITY_IAM \
        --region "$REGION"; then
        print_error "CloudFormation deployment failed"
        exit 1
    fi
    
    # Wait for stack operation to complete
    print_status "Waiting for stack operation to complete..."
    if [[ "$OPERATION" == "create-stack" ]]; then
        aws cloudformation wait stack-create-complete --stack-name "$STACK_NAME" --region "$REGION"
    else
        aws cloudformation wait stack-update-complete --stack-name "$STACK_NAME" --region "$REGION"
    fi
    
    # Cleanup
    if [ -f "template.yaml.bak" ]; then
        mv template.yaml.bak template.yaml
    fi
    rm -f function.zip
    
    # Cleanup S3 bucket if we created it
    if aws s3 ls "s3://$BUCKET_NAME" &>/dev/null; then
        aws s3 rm "s3://$BUCKET_NAME" --recursive --region "$REGION"
        aws s3 rb "s3://$BUCKET_NAME" --region "$REGION"
    fi
fi

print_success "Deployment completed successfully!"

# Get stack outputs
print_status "Retrieving stack outputs..."
OUTPUTS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query 'Stacks[0].Outputs' --output table 2>/dev/null || echo "No outputs available")

if [ "$OUTPUTS" != "No outputs available" ]; then
    echo ""
    print_status "Stack Outputs:"
    echo "$OUTPUTS"
fi

# Show useful next steps
echo ""
print_success "Deployment Summary:"
echo "  Stack Name: $STACK_NAME"
echo "  Region: $REGION"
echo "  Stage: $STAGE"
echo ""
print_status "Next Steps:"
echo "  1. Monitor the function in CloudWatch Logs"
echo "  2. Check the CloudWatch Dashboard for metrics"
echo "  3. Test the function with a manual invocation"
echo "  4. Verify Discord notifications are working"
echo ""
print_status "Useful Commands:"
echo "  # View function logs:"
echo "    aws logs tail /aws/lambda/maker-job-watcher-$STAGE --follow --region $REGION"
echo ""
echo "  # Invoke function manually:"
echo "    aws lambda invoke --function-name maker-job-watcher-$STAGE --region $REGION response.json"
echo ""
echo "  # Test connectivity:"
echo "    aws lambda invoke --function-name maker-job-watcher-$STAGE --payload '{\"test\":true}' --region $REGION response.json"

print_success "All done! 🚀"