#!/usr/bin/env ts-node
/**
 * Test script to verify Slack alerts are working
 * 
 * Usage:
 *   pnpm test:slack
 */

import 'dotenv/config';
import { sendSlackAlert } from '../src/services/slackService';
import { logger } from '../src/utils/logger';
import { nanoid } from 'nanoid';

async function main() {
  logger.info('=== Testing Slack Alerts (Direct) ===');
  logger.info('');

  try {
    // Test 1: Send a 5xx error alert
    logger.info('[Test 1] Sending 5xx error alert...');
    await sendSlackAlert({
      findingId: nanoid(),
      url: 'https://httpbin.org/status/500',
      errorType: '5xx',
      status: 500,
      latencyMs: 2500,
      error: 'Internal Server Error',
      timestamp: new Date(),
      fingerprint: 'sha256:test-5xx-alert-' + Date.now(),
      isFirstSeen: true,
      host: 'httpbin.org',
      path: '/status/500',
    });
    logger.info('✅ 5xx alert sent');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 2: Send a high latency alert
    logger.info('[Test 2] Sending high latency alert...');
    await sendSlackAlert({
      findingId: nanoid(),
      url: 'https://httpbin.org/delay/2',
      errorType: 'latency',
      status: 200,
      latencyMs: 3500,
      timestamp: new Date(),
      fingerprint: 'sha256:test-latency-alert-' + Date.now(),
      isFirstSeen: false,
      host: 'httpbin.org',
      path: '/delay/2',
    });
    logger.info('✅ Latency alert sent');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 3: Send a timeout error alert
    logger.info('[Test 3] Sending timeout error alert...');
    await sendSlackAlert({
      findingId: nanoid(),
      url: 'https://httpbin.org/delay/10',
      errorType: 'timeout',
      latencyMs: 2000,
      error: 'Request timeout after 2000ms',
      timestamp: new Date(),
      fingerprint: 'sha256:test-timeout-alert-' + Date.now(),
      isFirstSeen: true,
      host: 'httpbin.org',
      path: '/delay/10',
    });
    logger.info('✅ Timeout alert sent');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 4: Send a network error alert
    logger.info('[Test 4] Sending network error alert...');
    await sendSlackAlert({
      findingId: nanoid(),
      url: 'https://this-domain-does-not-exist-12345.com',
      errorType: 'network',
      latencyMs: 950,
      error: 'fetch failed - DNS resolution failed',
      timestamp: new Date(),
      fingerprint: 'sha256:test-network-alert-' + Date.now(),
      isFirstSeen: true,
      host: 'this-domain-does-not-exist-12345.com',
      path: '/',
    });
    logger.info('✅ Network alert sent');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    logger.info('');
    logger.info('=== Test Complete ===');
    logger.info('✨ All 4 alerts have been sent to Slack!');
    logger.info('');
    logger.info('Check your Slack channel for the following alerts:');
    logger.info('  1. 🔥 Server Error (5xx) - New');
    logger.info('  2. 🐌 High Latency (3500ms) - Duplicate');
    logger.info('  3. ⏱️  Request Timeout - New');
    logger.info('  4. 🌐 Network Error - New');
    logger.info('');
    logger.info('Each alert should have:');
    logger.info('  • Re-verify button → GET /api/slack/actions?action=reverify&findingId=...');
    logger.info('  • Suppress 24h button → GET /api/slack/actions?action=suppress24h&findingId=...');
    logger.info('');
    logger.info('If no alerts appeared, check:');
    logger.info('  1. SLACK_WEBHOOK_URL is set correctly in .env');
    logger.info('  2. Webhook URL is active and valid');
    logger.info('  3. Network connectivity to Slack');
  } catch (error) {
    logger.error('❌ Test failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
