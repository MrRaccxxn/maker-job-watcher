import fetch from 'node-fetch';
import { DiscordAlert, JobStatus } from '../types';

export class DiscordNotifier {
  constructor(private readonly webhookUrl: string) {}

  public async sendAlert(staleJobs: JobStatus[], totalJobs: number): Promise<boolean> {
    const alert = staleJobs.length === 0 
      ? this.createHealthyStatusAlert(totalJobs)
      : this.createAlert(staleJobs, totalJobs);

    
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(alert),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Discord webhook failed: ${response.status} - ${errorText}`);
        return false;
      }

      const messageType = staleJobs.length === 0 ? 'status update' : `alert for ${staleJobs.length} stale jobs`;
      console.log(`Discord ${messageType} sent successfully`);
      return true;
    } catch (error) {
      console.error('Error sending Discord alert:', error);
      return false;
    }
  }

  public async sendTestMessage(): Promise<boolean> {
    const testAlert: DiscordAlert = {
      embeds: [
        {
          title: '🧪 MakerDAO Job Watcher Test',
          description: 'Test message from MakerDAO Job Watcher Lambda function.',
          color: 0x00ff00, // Green
          fields: [
            {
              name: 'Status',
              value: 'Service is operational',
              inline: true,
            },
            {
              name: 'Timestamp',
              value: new Date().toISOString(),
              inline: true,
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    };

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testAlert),
      });

      return response.ok;
    } catch (error) {
      console.error('Error sending Discord test message:', error);
      return false;
    }
  }

  private createAlert(staleJobs: JobStatus[], totalJobs: number): DiscordAlert {
    const color = this.getAlertColor(staleJobs.length, totalJobs);
    const severity = this.getAlertSeverity(staleJobs.length, totalJobs);
    
    const fields = [
      {
        name: '📊 Summary',
        value: `${staleJobs.length} of ${totalJobs} jobs need attention`,
        inline: true,
      },
      {
        name: '🕐 Detected At',
        value: new Date().toLocaleString('en-US', {
          timeZone: 'UTC',
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }) + ' UTC',
        inline: true,
      },
      {
        name: '⚡ Severity',
        value: severity,
        inline: true,
      },
    ];

    // Add details for each stale job (limit to prevent message overflow)
    const maxJobsToShow = 10;
    const jobsToShow = staleJobs.slice(0, maxJobsToShow);
    
    if (jobsToShow.length > 0) {
      const jobList = jobsToShow
        .map((job, index) => {
          const emoji = job.workable ? '🟡' : '🔴';
          const status = job.workable ? 'Workable' : 'Not Workable';
          const lastWorked = job.lastWorkedBlock 
            ? `Last worked: Block ${job.lastWorkedBlock}`
            : 'No recent work found';
          
          return `${emoji} **Job ${index + 1}**\n` +
                 `Address: \`${this.formatAddress(job.address)}\`\n` +
                 `Status: ${status}\n` +
                 `${lastWorked}`;
        })
        .join('\n\n');

      fields.push({
        name: '🔍 Job Details',
        value: jobList,
        inline: false,
      });

      if (staleJobs.length > maxJobsToShow) {
        fields.push({
          name: '📝 Note',
          value: `... and ${staleJobs.length - maxJobsToShow} more jobs`,
          inline: false,
        });
      }
    }

    // Add recommendations
    const recommendations = this.getRecommendations(staleJobs);
    if (recommendations) {
      fields.push({
        name: '💡 Recommendations',
        value: recommendations,
        inline: false,
      });
    }

    return {
      embeds: [
        {
          title: '🚨 MakerDAO Job Alert - Stale Jobs Detected',
          description: `Detected ${staleJobs.length} job${staleJobs.length === 1 ? '' : 's'} that ${staleJobs.length === 1 ? 'has' : 'have'} not been worked in the last 10 blocks but ${staleJobs.length === 1 ? 'is' : 'are'} workable.`,
          color,
          fields,
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  private getAlertColor(staleJobsCount: number, totalJobs: number): number {
    const percentage = (staleJobsCount / totalJobs) * 100;
    
    if (percentage >= 50) return 0xff0000; // Red - Critical
    if (percentage >= 25) return 0xff8c00; // Orange - High
    if (percentage >= 10) return 0xffff00; // Yellow - Medium
    return 0xffa500; // Orange - Low
  }

  private getAlertSeverity(staleJobsCount: number, totalJobs: number): string {
    const percentage = (staleJobsCount / totalJobs) * 100;
    
    if (percentage >= 50) return '🔴 Critical';
    if (percentage >= 25) return '🟠 High';
    if (percentage >= 10) return '🟡 Medium';
    return '🟤 Low';
  }

  private getRecommendations(staleJobs: JobStatus[]): string {
    const workableJobs = staleJobs.filter(job => job.workable);
    const recommendations: string[] = [];

    if (workableJobs.length > 0) {
      recommendations.push('• Consider manually triggering workable jobs');
      recommendations.push('• Check if keeper bots are running properly');
      recommendations.push('• Verify gas prices and network congestion');
    }

    if (staleJobs.some(job => !job.workable)) {
      recommendations.push('• Review jobs that are not workable for configuration issues');
    }

    recommendations.push('• Monitor the next few blocks for automatic resolution');

    return recommendations.join('\n');
  }

  private formatAddress(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  private createHealthyStatusAlert(totalJobs: number): DiscordAlert {
    return {
      embeds: [
        {
          title: '✅ MakerDAO Job Watcher - All Systems Healthy',
          description: `Job monitoring completed successfully. All ${totalJobs} jobs are working properly.`,
          color: 0x00ff00, // Green
          fields: [
            {
              name: '📊 Status',
              value: `${totalJobs} jobs monitored\n0 stale jobs found`,
              inline: true,
            },
            {
              name: '🕐 Scan Time',
              value: new Date().toLocaleString('en-US', {
                timeZone: 'UTC',
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }) + ' UTC',
              inline: true,
            },
            {
              name: '⚡ Next Scan',
              value: 'In 5 minutes',
              inline: true,
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  public async sendErrorAlert(error: Error, context?: string): Promise<boolean> {
    const alert: DiscordAlert = {
      embeds: [
        {
          title: '🚨 MakerDAO Job Watcher - Error Detected',
          description: `An error occurred during job monitoring${context ? ` (${context})` : ''}.`,
          color: 0xff0000, // Red
          fields: [
            {
              name: '❌ Error',
              value: `\`\`\`${error.message}\`\`\``,
              inline: false,
            },
            {
              name: '🕐 Error Time',
              value: new Date().toLocaleString('en-US', {
                timeZone: 'UTC',
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }) + ' UTC',
              inline: true,
            },
            {
              name: '🔧 Action Required',
              value: 'Check Lambda logs for detailed error information',
              inline: true,
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    };

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(alert),
      });

      if (!response.ok) {
        console.error(`Discord error webhook failed: ${response.status}`);
        return false;
      }

      console.log('Discord error alert sent successfully');
      return true;
    } catch (fetchError) {
      console.error('Error sending Discord error alert:', fetchError);
      return false;
    }
  }

  public async sendRecoveryNotification(
    previousStaleCount: number,
    currentStaleCount: number
  ): Promise<boolean> {
    if (currentStaleCount >= previousStaleCount) {
      return true; // No recovery to report
    }

    const recoveredJobs = previousStaleCount - currentStaleCount;
    
    const alert: DiscordAlert = {
      embeds: [
        {
          title: '✅ MakerDAO Job Recovery',
          description: `Good news! ${recoveredJobs} job${recoveredJobs === 1 ? '' : 's'} ${recoveredJobs === 1 ? 'has' : 'have'} been worked and ${recoveredJobs === 1 ? 'is' : 'are'} no longer stale.`,
          color: 0x00ff00, // Green
          fields: [
            {
              name: '📈 Recovery Stats',
              value: `${recoveredJobs} jobs recovered\n${currentStaleCount} jobs still stale`,
              inline: true,
            },
            {
              name: '🕐 Recovery Time',
              value: new Date().toLocaleString('en-US', {
                timeZone: 'UTC',
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }) + ' UTC',
              inline: true,
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    };

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(alert),
      });

      return response.ok;
    } catch (error) {
      console.error('Error sending Discord recovery notification:', error);
      return false;
    }
  }
}