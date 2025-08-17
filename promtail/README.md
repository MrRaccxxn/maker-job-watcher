# Promtail Integration for MakerDAO Job Watcher

This directory contains the Promtail configuration for shipping logs from the MakerDAO Job Watcher to Grafana Loki.

## 📋 Overview

**Promtail** is Grafana's log shipping agent that reads log files and sends them to Loki. This approach is more robust than direct HTTP shipping and follows Grafana's recommended architecture.

### 🔄 Architecture Flow
```
Logger → JSON Files → Promtail → Loki → Grafana
```

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose installed
- Environment variables configured in `.env`

### 1. Start Promtail
```bash
# Option 1: Using the start script
./start-promtail.sh

# Option 2: Manual Docker Compose
docker-compose up -d
```

### 2. Generate Log Files
```bash
# Run your application to generate logs
npm run dev

# Or run the test to generate sample logs
npm run test:logger
```

### 3. Verify Shipping
- Check Promtail status: `docker-compose logs promtail`
- View Promtail dashboard: http://localhost:9080
- Check Grafana for incoming logs

## 📁 File Structure

```
promtail/
├── promtail.yml          # Promtail configuration
├── docker-compose.yml    # Docker setup
├── start-promtail.sh    # Quick start script
└── README.md            # This file
```

## ⚙️ Configuration

### Environment Variables
The logger automatically uses Promtail when:
- `USE_PROMTAIL=true` (explicit setting)
- `NODE_ENV=development` (development mode)
- Not running in AWS Lambda (local/server environments)

### Log File Locations
- **Production**: `/var/log/maker-job-watcher/*.json`
- **Development**: `./logs/*.json`
- **Lambda**: `/tmp/logs/*.json`

### Promtail Configuration (`promtail.yml`)
The configuration includes:
- **Authentication**: Service account token to Grafana Cloud Loki
- **File Discovery**: Automatically detects new log files
- **JSON Parsing**: Extracts structured fields from JSON logs
- **Label Extraction**: Promotes important fields to labels for filtering

## 🔍 Log Format

The logger writes NDJSON (Newline Delimited JSON) files:
```json
{"timestamp":"2025-08-17T03:49:52.391Z","level":"INFO","service":"maker-job-watcher","message":"Job scan started","labels":{"environment":"dev","aws_region":"us-east-1"},"context":{"metrics":{"totalJobs":8}}}
```

### Key Fields
- `timestamp`: ISO 8601 timestamp
- `level`: Log level (INFO, WARN, ERROR, DEBUG)
- `service`: Always "maker-job-watcher"
- `message`: Human-readable log message
- `labels`: Metadata for filtering and grouping
- `context`: Additional structured data

## 🔧 Troubleshooting

### Check Promtail Status
```bash
# View container status
docker-compose ps

# View Promtail logs
docker-compose logs promtail

# Follow live logs
docker-compose logs -f promtail
```

### Common Issues

**No logs appearing in Grafana:**
1. Check Promtail is reading files: `docker-compose logs promtail | grep "Successfully"`
2. Verify authentication: Check for 401/403 errors in logs
3. Confirm log files exist: `ls -la ../logs/`

**Promtail won't start:**
1. Check Docker is running: `docker info`
2. Verify configuration syntax: `docker-compose config`
3. Check port conflicts: `lsof -i :9080`

**Permission errors:**
1. Ensure log directory is readable: `chmod 755 ../logs`
2. Check Docker volume permissions

## 📊 Monitoring

### Promtail Metrics
Access Promtail's built-in metrics at: http://localhost:9080/metrics

Key metrics to monitor:
- `promtail_files_active_total`: Number of files being tailed
- `promtail_read_lines_total`: Total lines read
- `promtail_sent_entries_total`: Total entries sent to Loki

### Grafana Queries
Once logs are in Loki, use these LogQL queries:

```logql
# All logs from the service
{service="maker-job-watcher"}

# Error logs only
{service="maker-job-watcher", level="ERROR"}

# Job scan related logs
{service="maker-job-watcher"} |= "Job scan"

# Performance metrics
{service="maker-job-watcher"} | json | context_performance_executionTime > 2000
```

## 🔄 Log Rotation

The logger automatically rotates log files:
- **Max file size**: 100MB
- **Max files kept**: 10
- **Rotation trigger**: When size limit exceeded

Promtail automatically detects new files and continues shipping.

## 🛠️ Production Deployment

For production environments:

1. **Use proper volumes**:
   ```yaml
   volumes:
     - /var/log/maker-job-watcher:/var/log/maker-job-watcher:ro
   ```

2. **Configure log retention**:
   ```yaml
   logging:
     driver: "json-file"
     options:
       max-size: "10m"
       max-file: "3"
   ```

3. **Monitor Promtail health**:
   - Set up alerts on shipping failures
   - Monitor disk usage for log files
   - Configure backup retention policies

## 🔗 Related Documentation

- [Promtail Configuration](https://grafana.com/docs/loki/latest/clients/promtail/configuration/)
- [LogQL Query Language](https://grafana.com/docs/loki/latest/logql/)
- [Grafana Loki Documentation](https://grafana.com/docs/loki/latest/)