#!/bin/bash

echo "🚀 Starting MakerDAO Job Watcher - Local Logging Stack"
echo "====================================================="

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Stop any existing containers to avoid conflicts
echo "🧹 Cleaning up any existing containers..."
docker-compose -f docker-compose.logging.yml down 2>/dev/null || true

# Stop the old Promtail container from previous setup
cd promtail 2>/dev/null && docker-compose down 2>/dev/null && cd .. || true

# Create logs directory if it doesn't exist
mkdir -p logs

# Start the complete logging stack
echo "📦 Starting complete logging stack (Loki + Grafana + Promtail)..."
docker-compose -f docker-compose.logging.yml up -d

# Wait for services to start
echo "⏳ Waiting for services to start..."
sleep 10

# Check service status
echo "📊 Checking service status..."
docker-compose -f docker-compose.logging.yml ps

# Test connections
echo ""
echo "🔍 Testing service connections..."

# Test Loki
if curl -s http://localhost:3100/ready > /dev/null; then
    echo "✅ Loki is ready at http://localhost:3100"
else
    echo "❌ Loki is not responding"
fi

# Test Grafana
if curl -s http://localhost:3000/api/health > /dev/null; then
    echo "✅ Grafana is ready at http://localhost:3000"
else
    echo "❌ Grafana is not responding"
fi

# Test Promtail
if curl -s http://localhost:9081/targets > /dev/null; then
    echo "✅ Promtail is ready at http://localhost:9081"
else
    echo "❌ Promtail is not responding"
fi

echo ""
echo "🎯 Local Logging Stack is Running!"
echo "================================="
echo "📊 Grafana Dashboard: http://localhost:3000"
echo "   - Username: admin"
echo "   - Password: admin"
echo "   - Default dashboard: MakerDAO Job Watcher - Logs Dashboard"
echo ""
echo "🔍 Loki API: http://localhost:3100"
echo "📡 Promtail Dashboard: http://localhost:9081"
echo ""
echo "📝 Log files being monitored: ./logs/*.json"
echo ""
echo "🔧 Management Commands:"
echo "   View logs: docker-compose -f docker-compose.logging.yml logs -f [service]"
echo "   Stop stack: docker-compose -f docker-compose.logging.yml down"
echo "   Restart: docker-compose -f docker-compose.logging.yml restart [service]"
echo ""
echo "🧪 To test the logging:"
echo "   npm run build && node dist/test-logger.js"