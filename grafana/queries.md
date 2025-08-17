# Grafana Queries for MakerDAO Job Watcher

## 📊 Useful LogQL Queries for Grafana Dashboards

### 1. **Error Rate Over Time**
```logql
sum(rate({service="maker-job-watcher", level="error"}[5m])) by (function_name)
```

### 2. **Job Scan Success Rate**
```logql
sum(rate({service="maker-job-watcher"} |= "Job scan completed"[5m])) 
/ 
sum(rate({service="maker-job-watcher"} |= "Job scan"[5m])) * 100
```

### 3. **RPC Call Performance**
```logql
{service="maker-job-watcher"} 
| json 
| context_rpcCallsCount != "" 
| unwrap context_rpcCallsCount 
| quantile_over_time(0.95, [5m])
```

### 4. **Execution Time Distribution**
```logql
{service="maker-job-watcher"} 
| json 
| data_metrics_executionTime != "" 
| unwrap data_metrics_executionTime 
| histogram_quantile(0.95, [5m])
```

### 5. **Stale Jobs Detected**
```logql
sum(count_over_time({service="maker-job-watcher"} |= "Stale workable jobs detected"[1h]))
```

### 6. **Recent Errors with Context**
```logql
{service="maker-job-watcher", level="error"} 
| json 
| line_format "{{.timestamp}} [{{.level}}] {{.message}} | Function: {{.context.functionName}} | Error: {{.data.error.message}}"
```

### 7. **Performance Metrics Over Time**
```logql
{service="maker-job-watcher"} 
| json 
| data_performance_rpcCallsCount != "" 
| unwrap data_performance_rpcCallsCount
```

### 8. **Alert Volume**
```logql
sum(rate({service="maker-job-watcher"} |= "alert"[10m])) by (level)
```

## 🎯 Grafana Dashboard Panels

### Panel 1: Service Health
- **Type**: Stat
- **Query**: Success rate query above
- **Thresholds**: Green >99%, Yellow >95%, Red <95%

### Panel 2: Error Timeline  
- **Type**: Time Series
- **Query**: Error rate query
- **Alert**: When error rate > 5%

### Panel 3: Performance Metrics
- **Type**: Time Series  
- **Queries**: RPC calls + Execution time
- **Y-Axis**: Dual axis for different units

### Panel 4: Recent Logs
- **Type**: Logs
- **Query**: Recent errors with context
- **Limit**: 100 lines

### Panel 5: Job Activity
- **Type**: Bar Chart
- **Query**: Stale jobs detected
- **Time Range**: Last 24h

## 🔔 Alerting Rules

### Critical Error Rate
```logql
sum(rate({service="maker-job-watcher", level="error"}[5m])) > 0.1
```

### Service Down
```logql
absent_over_time({service="maker-job-watcher"}[10m])
```

### High RPC Usage
```logql
{service="maker-job-watcher"} 
| json 
| context_rpcCallsCount > 10
```

## 🚀 Quick Setup Commands

```bash
# 1. Deploy with Grafana Cloud support
export GRAFANA_CLOUD_LOKI_URL="your_loki_url"
export GRAFANA_CLOUD_API_KEY="your_api_key"
npm run deploy

# 2. Test locally with cloud logging
npm run test:local

# 3. Import dashboard.json to your Grafana instance

# 4. Set up alerts using the rules above
```

## 📈 Custom Metrics You Can Track

- `maker_job_watcher_scans_total` - Total scans performed
- `maker_job_watcher_stale_jobs` - Number of stale jobs found
- `maker_job_watcher_rpc_calls` - RPC calls per execution
- `maker_job_watcher_execution_duration` - How long each scan takes
- `maker_job_watcher_alerts_sent` - Discord alerts sent
- `maker_job_watcher_errors_total` - Total errors encountered