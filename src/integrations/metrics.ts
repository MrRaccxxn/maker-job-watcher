import { CloudWatchClient, PutMetricDataCommand, StandardUnit, MetricDatum } from '@aws-sdk/client-cloudwatch';
import { MetricsData } from '../types';

export class MetricsPublisher {
  private readonly cloudWatch: CloudWatchClient;
  private readonly namespace = 'MakerDAO/JobWatcher';

  constructor(region: string = 'us-east-1') {
    this.cloudWatch = new CloudWatchClient({ region });
  }

  public async publishMetrics(metrics: MetricsData): Promise<boolean> {
    const timestamp = new Date();
    
    const metricData: MetricDatum[] = [
      {
        MetricName: 'JobsNotWorkedCount',
        Value: metrics.jobsNotWorkedCount,
        Unit: StandardUnit.Count,
        Timestamp: timestamp,
        Dimensions: [
          {
            Name: 'Environment',
            Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
          },
        ],
      },
      {
        MetricName: 'RpcFailures',
        Value: metrics.rpcFailures,
        Unit: StandardUnit.Count,
        Timestamp: timestamp,
        Dimensions: [
          {
            Name: 'Environment',
            Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
          },
        ],
      },
      {
        MetricName: 'AlertsSent',
        Value: metrics.alertsSent,
        Unit: StandardUnit.Count,
        Timestamp: timestamp,
        Dimensions: [
          {
            Name: 'Environment',
            Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
          },
        ],
      },
      {
        MetricName: 'ExecutionDuration',
        Value: metrics.executionDuration,
        Unit: StandardUnit.Milliseconds,
        Timestamp: timestamp,
        Dimensions: [
          {
            Name: 'Environment',
            Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
          },
        ],
      },
    ];

    try {
      const command = new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: metricData,
      });

      await this.cloudWatch.send(command);
      console.log('Metrics published successfully to CloudWatch');
      return true;
    } catch (error) {
      console.error('Error publishing metrics to CloudWatch:', error);
      return false;
    }
  }

  public async publishHealthCheck(isHealthy: boolean): Promise<boolean> {
    const timestamp = new Date();
    
    const metricData: MetricDatum[] = [
      {
        MetricName: 'HealthCheck',
        Value: isHealthy ? 1 : 0,
        Unit: StandardUnit.Count,
        Timestamp: timestamp,
        Dimensions: [
          {
            Name: 'Environment',
            Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
          },
        ],
      },
    ];

    try {
      const command = new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: metricData,
      });

      await this.cloudWatch.send(command);
      return true;
    } catch (error) {
      console.error('Error publishing health check metric:', error);
      return false;
    }
  }

  public async publishJobMetrics(
    totalJobs: number,
    workableJobs: number,
    staleJobs: number
  ): Promise<boolean> {
    const timestamp = new Date();
    
    const metricData: MetricDatum[] = [
      {
        MetricName: 'TotalJobs',
        Value: totalJobs,
        Unit: StandardUnit.Count,
        Timestamp: timestamp,
        Dimensions: [
          {
            Name: 'Environment',
            Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
          },
        ],
      },
      {
        MetricName: 'WorkableJobs',
        Value: workableJobs,
        Unit: StandardUnit.Count,
        Timestamp: timestamp,
        Dimensions: [
          {
            Name: 'Environment',
            Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
          },
        ],
      },
      {
        MetricName: 'StaleJobs',
        Value: staleJobs,
        Unit: StandardUnit.Count,
        Timestamp: timestamp,
        Dimensions: [
          {
            Name: 'Environment',
            Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
          },
        ],
      },
    ];

    // Calculate percentages
    if (totalJobs > 0) {
      metricData.push(
        {
          MetricName: 'WorkableJobsPercentage',
          Value: (workableJobs / totalJobs) * 100,
          Unit: StandardUnit.Percent,
          Timestamp: timestamp,
          Dimensions: [
            {
              Name: 'Environment',
              Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
            },
          ],
        },
        {
          MetricName: 'StaleJobsPercentage',
          Value: (staleJobs / totalJobs) * 100,
          Unit: StandardUnit.Percent,
          Timestamp: timestamp,
          Dimensions: [
            {
              Name: 'Environment',
              Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
            },
          ],
        }
      );
    }

    try {
      const command = new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: metricData,
      });

      await this.cloudWatch.send(command);
      console.log('Job metrics published successfully to CloudWatch');
      return true;
    } catch (error) {
      console.error('Error publishing job metrics to CloudWatch:', error);
      return false;
    }
  }

  public async publishRpcMetrics(
    totalCalls: number,
    successfulCalls: number,
    failedCalls: number,
    averageResponseTime: number
  ): Promise<boolean> {
    const timestamp = new Date();
    
    const metricData: MetricDatum[] = [
      {
        MetricName: 'RpcTotalCalls',
        Value: totalCalls,
        Unit: StandardUnit.Count,
        Timestamp: timestamp,
        Dimensions: [
          {
            Name: 'Environment',
            Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
          },
        ],
      },
      {
        MetricName: 'RpcSuccessfulCalls',
        Value: successfulCalls,
        Unit: StandardUnit.Count,
        Timestamp: timestamp,
        Dimensions: [
          {
            Name: 'Environment',
            Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
          },
        ],
      },
      {
        MetricName: 'RpcFailedCalls',
        Value: failedCalls,
        Unit: StandardUnit.Count,
        Timestamp: timestamp,
        Dimensions: [
          {
            Name: 'Environment',
            Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
          },
        ],
      },
      {
        MetricName: 'RpcAverageResponseTime',
        Value: averageResponseTime,
        Unit: StandardUnit.Milliseconds,
        Timestamp: timestamp,
        Dimensions: [
          {
            Name: 'Environment',
            Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
          },
        ],
      },
    ];

    // Calculate success rate
    if (totalCalls > 0) {
      metricData.push({
        MetricName: 'RpcSuccessRate',
        Value: (successfulCalls / totalCalls) * 100,
        Unit: StandardUnit.Percent,
        Timestamp: timestamp,
        Dimensions: [
          {
            Name: 'Environment',
            Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
          },
        ],
      });
    }

    try {
      const command = new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: metricData,
      });

      await this.cloudWatch.send(command);
      console.log('RPC metrics published successfully to CloudWatch');
      return true;
    } catch (error) {
      console.error('Error publishing RPC metrics to CloudWatch:', error);
      return false;
    }
  }

  public async publishCustomMetric(
    name: string,
    value: number,
    unit: StandardUnit = StandardUnit.Count,
    dimensions?: Array<{ Name: string; Value: string }>
  ): Promise<boolean> {
    const timestamp = new Date();
    
    const defaultDimensions = [
      {
        Name: 'Environment',
        Value: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
      },
    ];

    const metricData: MetricDatum[] = [
      {
        MetricName: name,
        Value: value,
        Unit: unit,
        Timestamp: timestamp,
        Dimensions: dimensions ? [...defaultDimensions, ...dimensions] : defaultDimensions,
      },
    ];

    try {
      const command = new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: metricData,
      });

      await this.cloudWatch.send(command);
      console.log(`Custom metric '${name}' published successfully to CloudWatch`);
      return true;
    } catch (error) {
      console.error(`Error publishing custom metric '${name}' to CloudWatch:`, error);
      return false;
    }
  }
}