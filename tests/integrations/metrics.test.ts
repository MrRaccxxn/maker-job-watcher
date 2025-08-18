import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { MetricsPublisher } from '../../src/integrations/metrics';
import { MetricsData } from '../../src/types';

jest.mock('@aws-sdk/client-cloudwatch');

describe('MetricsPublisher', () => {
  let metricsPublisher: MetricsPublisher;
  let mockSend: jest.Mock;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockSend = jest.fn().mockResolvedValue({});

    (CloudWatchClient as jest.Mock).mockImplementation(() => ({
      send: mockSend,
    }));

    metricsPublisher = new MetricsPublisher('us-east-1');
    
    // Suppress console output during tests to reduce noise
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('publishMetrics', () => {
    it('should publish metrics to CloudWatch', async () => {
      const metrics: MetricsData = {
        jobsNotWorkedCount: 5,
        rpcFailures: 2,
        alertsSent: 1,
        executionDuration: 1500,
      };

      const result = await metricsPublisher.publishMetrics(metrics);

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutMetricDataCommand));
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle CloudWatch errors', async () => {
      const metrics: MetricsData = {
        jobsNotWorkedCount: 0,
        rpcFailures: 0,
        alertsSent: 0,
        executionDuration: 1000,
      };

      mockSend.mockRejectedValue(new Error('CloudWatch error'));

      const result = await metricsPublisher.publishMetrics(metrics);

      expect(result).toBe(false);
    });
  });

  describe('publishHealthCheck', () => {
    it('should publish health check metric', async () => {
      const result = await metricsPublisher.publishHealthCheck(true);

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutMetricDataCommand));
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should publish unhealthy status', async () => {
      await metricsPublisher.publishHealthCheck(false);

      expect(mockSend).toHaveBeenCalledWith(expect.any(PutMetricDataCommand));
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('publishJobMetrics', () => {
    it('should publish job metrics with percentages', async () => {
      const result = await metricsPublisher.publishJobMetrics(10, 7, 3);

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutMetricDataCommand));
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle zero total jobs', async () => {
      const result = await metricsPublisher.publishJobMetrics(0, 0, 0);

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutMetricDataCommand));
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('publishRpcMetrics', () => {
    it('should publish RPC metrics with success rate', async () => {
      const result = await metricsPublisher.publishRpcMetrics(100, 95, 5, 250);

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutMetricDataCommand));
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle zero total calls', async () => {
      const result = await metricsPublisher.publishRpcMetrics(0, 0, 0, 0);

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutMetricDataCommand));
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('publishCustomMetric', () => {
    it('should publish custom metric with default dimensions', async () => {
      const result = await metricsPublisher.publishCustomMetric('CustomMetric', 42);

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutMetricDataCommand));
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should publish custom metric with additional dimensions', async () => {
      const customDimensions = [
        {
          Name: 'JobType',
          Value: 'TestJob',
        },
      ];

      await metricsPublisher.publishCustomMetric('CustomMetric', 42, undefined, customDimensions);

      expect(mockSend).toHaveBeenCalledWith(expect.any(PutMetricDataCommand));
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should use function name from environment when available', async () => {
      const originalEnv = process.env.AWS_LAMBDA_FUNCTION_NAME;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-function';

      await metricsPublisher.publishCustomMetric('TestMetric', 1);

      expect(mockSend).toHaveBeenCalledWith(expect.any(PutMetricDataCommand));
      expect(mockSend).toHaveBeenCalledTimes(1);

      // Restore original environment
      if (originalEnv) {
        process.env.AWS_LAMBDA_FUNCTION_NAME = originalEnv;
      } else {
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      }
    });
  });
});