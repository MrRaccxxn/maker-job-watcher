import fetch from 'node-fetch';
import { DiscordNotifier } from '../../src/integrations/discord';
import { JobStatus } from '../../src/types';

jest.mock('node-fetch');

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('DiscordNotifier', () => {
  let discordNotifier: DiscordNotifier;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  const webhookUrl = 'https://discord.com/api/webhooks/test';

  beforeEach(() => {
    discordNotifier = new DiscordNotifier(webhookUrl);
    
    // Suppress console output during tests to reduce noise
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('sendAlert', () => {
    it('should send Discord alert for stale jobs', async () => {
      const staleJobs: JobStatus[] = [
        {
          address: '0x1234567890123456789012345678901234567890',
          workable: true,
          lastWorkedBlock: 1000,
          isStale: true,
        },
        {
          address: '0x9876543210987654321098765432109876543210',
          workable: true,
          isStale: true,
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
      } as any);

      const result = await discordNotifier.sendAlert(staleJobs, 10);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: expect.stringContaining('embeds'),
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      
      expect(body.embeds).toHaveLength(1);
      expect(body.embeds[0].title).toContain('Stale Jobs Detected');
      expect(body.embeds[0].description).toContain('2 jobs');
    });

    it('should send healthy status when no stale jobs', async () => {
      const result = await discordNotifier.sendAlert([], 10);
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
      
      const [url, options] = mockFetch.mock.calls[0] as [string, { body: string }];
      expect(url).toBe('https://discord.com/api/webhooks/test');
      
      const body = JSON.parse(options.body);
      expect(body.embeds).toHaveLength(1);
      expect(body.embeds[0].title).toContain('All Systems Healthy');
      expect(body.embeds[0].description).toContain('10 jobs are working properly');
    });

    it('should handle HTTP errors', async () => {
      const staleJobs: JobStatus[] = [
        {
          address: '0x1234567890123456789012345678901234567890',
          workable: true,
          isStale: true,
        },
      ];

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      } as any);

      const result = await discordNotifier.sendAlert(staleJobs, 5);

      expect(result).toBe(false);
    });

    it('should handle network errors', async () => {
      const staleJobs: JobStatus[] = [
        {
          address: '0x1234567890123456789012345678901234567890',
          workable: true,
          isStale: true,
        },
      ];

      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await discordNotifier.sendAlert(staleJobs, 5);

      expect(result).toBe(false);
    });

    it('should format large number of jobs correctly', async () => {
      const staleJobs: JobStatus[] = Array.from({ length: 15 }, (_, i) => ({
        address: `0x${i.toString().padStart(40, '0')}`,
        workable: true,
        isStale: true,
      }));

      mockFetch.mockResolvedValue({
        ok: true,
      } as any);

      await discordNotifier.sendAlert(staleJobs, 20);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      
      // Should show details for max 10 jobs plus a note about additional jobs
      const jobDetailsField = body.embeds[0].fields.find((f: any) => f.name === '🔍 Job Details');
      const noteField = body.embeds[0].fields.find((f: any) => f.name === '📝 Note');
      
      expect(jobDetailsField).toBeDefined();
      expect(noteField).toBeDefined();
      expect(noteField.value).toContain('5 more jobs');
    });
  });

  describe('sendTestMessage', () => {
    it('should send test message successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
      } as any);

      const result = await discordNotifier.sendTestMessage();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: expect.stringContaining('Test message'),
      });
    });

    it('should handle test message failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
      } as any);

      const result = await discordNotifier.sendTestMessage();

      expect(result).toBe(false);
    });
  });

  describe('sendRecoveryNotification', () => {
    it('should send recovery notification when jobs recover', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
      } as any);

      const result = await discordNotifier.sendRecoveryNotification(5, 2);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalled();

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      
      expect(body.embeds[0].title).toContain('Recovery');
      expect(body.embeds[0].description).toContain('3 jobs');
      expect(body.embeds[0].color).toBe(0x00ff00); // Green
    });

    it('should not send notification when no recovery', async () => {
      const result = await discordNotifier.sendRecoveryNotification(3, 5);

      expect(result).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not send notification when same count', async () => {
      const result = await discordNotifier.sendRecoveryNotification(3, 3);

      expect(result).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('alert color and severity', () => {
    it('should use correct colors based on severity', async () => {
      const testCases = [
        { staleCount: 5, totalJobs: 10, expectedColor: 0xff0000 }, // 50% - Critical
        { staleCount: 3, totalJobs: 10, expectedColor: 0xff8c00 }, // 30% - High
        { staleCount: 1, totalJobs: 10, expectedColor: 0xffff00 }, // 10% - Medium
        { staleCount: 1, totalJobs: 20, expectedColor: 0xffa500 }, // 5% - Low
      ];

      for (const testCase of testCases) {
        const staleJobs: JobStatus[] = Array.from({ length: testCase.staleCount }, (_, i) => ({
          address: `0x${i.toString().padStart(40, '0')}`,
          workable: true,
          isStale: true,
        }));

        mockFetch.mockResolvedValue({ ok: true } as any);

        await discordNotifier.sendAlert(staleJobs, testCase.totalJobs);

        const callArgs = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
        const body = JSON.parse(callArgs[1]?.body as string);
        
        expect(body.embeds[0].color).toBe(testCase.expectedColor);
        
        mockFetch.mockClear();
      }
    });
  });
});