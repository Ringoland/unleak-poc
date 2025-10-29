import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { recordSlackAlert } from '../utils/metrics';
import { normalizeError } from '../utils/fingerprint';
import { getBaseUrl } from '../utils/baseUrl';

export interface SlackAlert {
  findingId: string;
  runId?: string;
  url: string;
  errorType: '5xx' | 'timeout' | 'latency' | 'network';
  latencyMs?: number;
  status?: number;
  error?: string;
  timestamp?: Date;
  fingerprint?: string;
  isFirstSeen?: boolean; // New finding vs duplicate
  host?: string;
  path?: string;
}

/**
 * Send an actionable alert to Slack with Re-verify and Suppress24h buttons
 */
export async function sendSlackAlert(alert: SlackAlert): Promise<void> {
  const webhookUrl = config.slackWebhookUrl;

  if (!webhookUrl) {
    logger.debug('[Slack] SLACK_WEBHOOK_URL not configured, skipping alert');
    return;
  }

  try {
    // Build the base URL for action links
    const baseUrl = process.env.BASE_URL || getBaseUrl();

    // Extract host and path
    const host = alert.host || new URL(alert.url).hostname;
    const path = alert.path || new URL(alert.url).pathname;

    // Normalize error message
    const normalizedError = alert.error ? normalizeError(alert.error) : 'Unknown error';

    // Determine latency bucket
    let latencyBucket = 'unknown';
    if (alert.latencyMs) {
      if (alert.latencyMs < 1000) latencyBucket = '<1s';
      else if (alert.latencyMs < 3000) latencyBucket = '1-3s';
      else if (alert.latencyMs < 10000) latencyBucket = '3-10s';
      else latencyBucket = '>10s';
    }

    // Format error message based on type
    let emoji = '🔴';
    let title = 'Alert';
    let color = '#FF0000';

    switch (alert.errorType) {
      case '5xx':
        emoji = '🔥';
        title = 'Server Error';
        color = '#FF4444';
        break;
      case 'timeout':
        emoji = '⏱️';
        title = 'Request Timeout';
        color = '#FFA500';
        break;
      case 'latency':
        emoji = '🐌';
        title = 'High Latency';
        color = '#FFAA00';
        break;
      case 'network':
        emoji = '🌐';
        title = 'Network Error';
        color = '#FF6600';
        break;
    }

    // Build Slack message payload with Block Kit
    const payload = {
      text: `${emoji} ${title} - ${host}${path}`,
      attachments: [
        {
          color,
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: `${emoji} ${title} ${alert.isFirstSeen ? '(New)' : '(Duplicate)'}`,
                emoji: true,
              },
            },
            {
              type: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: `*Host:*\n${host}`,
                },
                {
                  type: 'mrkdwn',
                  text: `*Path:*\n${path}`,
                },
                {
                  type: 'mrkdwn',
                  text: `*Error:*\n${normalizedError}`,
                },
                {
                  type: 'mrkdwn',
                  text: `*Latency:*\n${alert.latencyMs ? `${alert.latencyMs}ms (${latencyBucket})` : 'N/A'}`,
                },
                ...(alert.status
                  ? [
                      {
                        type: 'mrkdwn',
                        text: `*Status:*\nHTTP ${alert.status}`,
                      },
                    ]
                  : []),
                {
                  type: 'mrkdwn',
                  text: `*Time:*\n${(alert.timestamp || new Date()).toISOString()}`,
                },
              ],
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Links:* <${baseUrl}/admin/runs/${alert.runId || 'unknown'}|Open Run> • <${baseUrl}/admin/findings/${alert.findingId}|Open Finding> • <${baseUrl}/api/artifacts/${alert.findingId}|Artifacts>`,
              },
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '🔄 Re-verify now',
                    emoji: true,
                  },
                  style: 'primary',
                  url: `${baseUrl}/api/slack/actions?action=reverify&findingId=${alert.findingId}&t=${config.slackActionToken}`,
                },
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '🔇 Suppress 24h',
                    emoji: true,
                  },
                  style: 'danger',
                  url: `${baseUrl}/api/slack/actions?action=suppress24h&findingId=${alert.findingId}&t=${config.slackActionToken}`,
                },
              ],
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `Fingerprint: \`${alert.fingerprint?.substring(0, 16)}...\` | Finding ID: \`${alert.findingId}\``,
                },
              ],
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
      isFirstSeen: alert.isFirstSeen,
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
