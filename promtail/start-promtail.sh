#!/bin/bash

echo "🚀 Starting Promtail for MakerDAO Job Watcher"
echo "============================================="

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Create logs directory if it doesn't exist
mkdir -p ../logs

# Start Promtail
echo "📦 Starting Promtail container..."
docker-compose up -d

# Wait a moment for startup
sleep 3

# Check status
if docker-compose ps | grep -q "Up"; then
    echo "✅ Promtail is running!"
    echo ""
    echo "📊 Promtail Dashboard: http://localhost:9080"
    echo "📝 Log files being monitored: ../logs/*.json"
    echo "🎯 Shipping to: https://logs-prod-024.grafana.net/loki"
    echo ""
    echo "To view logs: docker-compose logs -f promtail"
    echo "To stop: docker-compose down"
else
    echo "❌ Failed to start Promtail"
    docker-compose logs promtail
    exit 1
fi