#!/usr/bin/env ts-node
/**
 * Test script to verify Slack alerts are working
 * 
 * Usage:
 *   ts-node src/scripts/testSlackAlerts.ts
 */

import 'dotenv/config';
import { initializeRedis } from '../src/config/redis';
import { initializeBreakerService } from '../src/services/breaker';
import { initializeFetcher } from '../src/services/fetcher';
import { logger } from '../src/utils/logger';

async function main() {
  logger.info('=== Testing Slack Alerts ===');

  // Initialize services
  const redis = await initializeRedis();
  initializeBreakerService(redis); // Initialize but don't need to store
  const fetcher = initializeFetcher({
    adapter: 'direct',
    defaultTimeoutMs: 5000,
    defaultRetries: 1,
  });

  try {
    // Test 1: Trigger a 5xx error (should send Slack alert)
    logger.info('\n[Test 1] Testing 5xx error alert...');
    const result1 = await fetcher.fetch('https://httpbin.org/status/500', {
      targetId: 'test-slack-5xx',
    });
    logger.info('Result:', result1);
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for async Slack call

    // Test 2: Trigger high latency alert
    logger.info('\n[Test 2] Testing high latency alert (>1500ms)...');
    const result2 = await fetcher.fetch('https://httpbin.org/delay/2', {
      targetId: 'test-slack-latency',
    });
    logger.info('Result:', result2);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 3: Trigger timeout error
    logger.info('\n[Test 3] Testing timeout alert...');
    const result3 = await fetcher.fetch('https://httpbin.org/delay/10', {
      targetId: 'test-slack-timeout',
      timeoutMs: 2000,
    });
    logger.info('Result:', result3);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 4: Trigger network error
    logger.info('\n[Test 4] Testing network error alert...');
    const result4 = await fetcher.fetch('https://this-domain-does-not-exist-12345.com', {
      targetId: 'test-slack-network',
    });
    logger.info('Result:', result4);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    logger.info('\n=== Test Complete ===');
    logger.info('Check your Slack channel for alerts!');
    logger.info('If no alerts appeared, verify:');
    logger.info('  1. SLACK_WEBHOOK_URL is set in .env');
    logger.info('  2. BREAKER_ENABLED=true in .env');
    logger.info('  3. Webhook URL is valid and active');
  } catch (error) {
    logger.error('Test failed:', error);
  } finally {
    await redis.quit();
    process.exit(0);
  }
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
