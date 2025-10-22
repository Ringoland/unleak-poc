import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { recordSlackAlert } from '../utils/metrics';

export interface SlackAlert {
  findingId: string;
  url: string;
  errorType: '5xx' | 'timeout' | 'latency' | 'network';
  latencyMs?: number;
  status?: number;
  error?: string;
  timestamp?: Date;
  fingerprint?: string; // Day-4: Optional fingerprint for deduplication
}

interface SlackButton {
  type: string;
  text: {
    type: string;
    text: string;
  };
  url?: string;
  value?: string;
}

/**
 * Send an actionable alert to Slack with Ack | Mute | Re-verify buttons
 */
export async function sendSlackAlert(alert: SlackAlert): Promise<void> {
  const webhookUrl = config.slackWebhookUrl;

  if (!webhookUrl) {
    logger.debug('[Slack] SLACK_WEBHOOK_URL not configured, skipping alert');
    return;
  }

  try {
    // Build the base URL for action links
    const baseUrl = process.env.BASE_URL || 'http://localhost:8000';

    // Format error message based on type
    let emoji = '🔴';
    let title = 'Alert';
    let description = '';

    switch (alert.errorType) {
      case '5xx':
        emoji = '🔥';
        title = 'Server Error Detected';
        description = `HTTP ${alert.status} error from ${alert.url}`;
        break;
      case 'timeout':
        emoji = '⏱️';
        title = 'Request Timeout';
        description = `Request to ${alert.url} timed out after ${alert.latencyMs}ms`;
        break;
      case 'latency':
        emoji = '🐌';
        title = 'High Latency Detected';
        description = `Request to ${alert.url} took ${alert.latencyMs}ms (threshold exceeded)`;
        break;
      case 'network':
        emoji = '🌐';
        title = 'Network Error';
        description = `Network error accessing ${alert.url}: ${alert.error}`;
        break;
    }

    // Create action buttons
    const buttons: SlackButton[] = [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '✅ Ack',
        },
        url: `${baseUrl}/api/slack/actions?act=ack&findingId=${alert.findingId}`,
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🔇 Mute',
        },
        url: `${baseUrl}/api/slack/actions?act=mute&findingId=${alert.findingId}`,
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🔄 Re-verify',
        },
        url: `${baseUrl}/api/findings/${alert.findingId}/reverify`,
      },
    ];

    // Build Slack message payload
    const payload = {
      text: `${emoji} ${title}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${emoji} ${title}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: description,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Finding ID:*\n${alert.findingId}`,
            },
            {
              type: 'mrkdwn',
              text: `*Time:*\n${(alert.timestamp || new Date()).toISOString()}`,
            },
            ...(alert.latencyMs
              ? [
                  {
                    type: 'mrkdwn',
                    text: `*Latency:*\n${alert.latencyMs}ms`,
                  },
                ]
              : []),
            ...(alert.status
              ? [
                  {
                    type: 'mrkdwn',
                    text: `*Status:*\n${alert.status}`,
                  },
                ]
              : []),
            ...(alert.fingerprint
              ? [
                  {
                    type: 'mrkdwn',
                    text: `*Fingerprint:*\n\`${alert.fingerprint.substring(0, 16)}...\``,
                  },
                ]
              : []),
          ],
        },
        {
          type: 'actions',
          elements: buttons,
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '💡 Click an action button above to manage this alert',
            },
          ],
        },
      ],
    };

    // Send to Slack webhook (non-blocking, fire and forget)
    await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 5000, // 5 second timeout
    });

    logger.info('[Slack] Alert sent successfully', {
      findingId: alert.findingId,
      errorType: alert.errorType,
      url: alert.url,
    });

    // Record metric
    recordSlackAlert(alert.errorType);
  } catch (error) {
    // Log error but don't throw - Slack alerts should be non-blocking
    logger.error('[Slack] Failed to send alert', {
      error: error instanceof Error ? error.message : String(error),
      findingId: alert.findingId,
    });
  }
}

/**
 * Send a simple text message to Slack (for testing or simple notifications)
 */
export async function sendSlackMessage(message: string): Promise<void> {
  const webhookUrl = config.slackWebhookUrl;

  if (!webhookUrl) {
    logger.debug('[Slack] SLACK_WEBHOOK_URL not configured, skipping message');
    return;
  }

  try {
    await axios.post(
      webhookUrl,
      { text: message },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      }
    );

    logger.info('[Slack] Message sent successfully');
  } catch (error) {
    logger.error('[Slack] Failed to send message', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
