#!/bin/bash

# Setup script for local testing environment

echo "🔧 Setting up MakerDAO Job Watcher local environment..."

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ Created .env file"
    echo ""
    echo "⚠️  Please edit .env file with your actual values:"
    echo "   - RPC_URL: Your Ethereum RPC endpoint (Alchemy, Infura, etc.)"
    echo "   - DISCORD_WEBHOOK_URL: Your Discord webhook URL"
    echo "   - SEQUENCER_ADDRESS: MakerDAO Sequencer contract address"
    echo ""
else
    echo "✅ .env file already exists"
fi

# Load environment variables for validation
if [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Validate required environment variables
echo "🔍 Validating environment variables..."

MISSING_VARS=()

if [ -z "$RPC_URL" ] || [ "$RPC_URL" = "RPC_URL" ]; then
    MISSING_VARS+=("RPC_URL")
fi

if [ -z "$DISCORD_WEBHOOK_URL" ] || [ "$DISCORD_WEBHOOK_URL" = "DISCORD_WEBHOOK_URL" ]; then
    MISSING_VARS+=("DISCORD_WEBHOOK_URL")
fi

if [ -z "$SEQUENCER_ADDRESS" ] || [ "$SEQUENCER_ADDRESS" = "SEQUENCER_ADDRESS" ]; then
    MISSING_VARS+=("SEQUENCER_ADDRESS")
fi

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo "❌ Missing or placeholder values for required variables:"
    for var in "${MISSING_VARS[@]}"; do
        echo "   - $var"
    done
    echo ""
    echo "📝 Please edit your .env file with real values:"
    echo ""
    echo "# Example .env file content:"
    echo "RPC_URL=https://eth-mainnet.alchemyapi.io/v2/YOUR_API_KEY"
    echo "DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_URL"
    echo "SEQUENCER_ADDRESS=0x1234567890123456789012345678901234567890"
    echo "BLOCKS_TO_ANALYZE=10"
    echo "NETWORK=0x0000000000000000000000000000000000000000000000000000000000000001"
    echo ""
    echo "🔗 Useful links:"
    echo "   - Alchemy: https://www.alchemy.com/"
    echo "   - Infura: https://infura.io/"
    echo "   - Discord Webhooks: https://support.discord.com/hc/en-us/articles/228383668"
    echo ""
    exit 1
else
    echo "✅ All required environment variables are set"
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
else
    echo "✅ Dependencies already installed"
fi

echo ""
echo "🎉 Environment setup complete!"
echo ""
echo "🚀 You can now run local tests:"
echo "   npm run test:local        # Run local Lambda simulation"
echo "   npm run start:local       # Run with auto-reload"
echo "   npm test                  # Run unit tests"
echo "   npm run test:coverage     # Run tests with coverage"
echo ""