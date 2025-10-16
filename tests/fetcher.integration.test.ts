import Redis from 'ioredis';
import { initializeBreakerService, BreakerService } from '../src/services/breaker';
import { initializeFetcher } from '../src/services/fetcher';
import { IFetcher } from '../src/services/fetcher/types';

describe('Fetcher with Circuit Breaker Integration', () => {
  let redis: Redis;
  let breaker: BreakerService;
  let fetcher: IFetcher;

  beforeAll(async () => {
    // Initialize Redis (use test database)
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      db: 15, // Use test database
    });

    // Initialize breaker service with test-friendly settings
    breaker = initializeBreakerService(redis, {
      failThreshold: 2, // Open after 2 failures (faster for tests)
      openDurationMs: 1000, // 1 second (short for tests)
      halfOpenProbeDelayMs: 500, // 500ms
    });

    // Initialize fetcher
    fetcher = initializeFetcher({
      adapter: 'direct',
      defaultTimeoutMs: 5000,
      defaultRetries: 1,
      debug: false,
    });
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    // Clear Redis test database before each test
    await redis.flushdb();
  });

  describe('Basic Fetcher Operations', () => {
    it('should fetch a URL successfully', async () => {
      const result = await fetcher.fetch('https://httpbin.org/status/200', {
        targetId: 'test-success',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.skipped).toBeUndefined();
      expect(result.latencyMs).toBeGreaterThan(0);
    });

    it('should work without targetId (no breaker tracking)', async () => {
      const result = await fetcher.fetch('https://httpbin.org/status/200');

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
    });

    it('should handle HTTP errors', async () => {
      const result = await fetcher.fetch('https://httpbin.org/status/500', {
        targetId: 'test-error',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(500);
    });
  });

  describe('Circuit Breaker Integration', () => {
    it('should record success for 2xx responses', async () => {
      const targetId = 'test-record-success';

      await fetcher.fetch('https://httpbin.org/status/200', { targetId });

      const stats = await breaker.getStats(targetId);
      expect(stats.state).toBe('closed');
      expect(stats.failCount).toBe(0);
    });

    it('should record failure for 5xx responses', async () => {
      const targetId = 'test-record-failure';

      await fetcher.fetch('https://httpbin.org/status/500', { targetId });

      const stats = await breaker.getStats(targetId);
      expect(stats.failCount).toBeGreaterThan(0);
    });

    it('should open circuit after threshold failures', async () => {
      const targetId = 'test-circuit-open';

      // First failure
      await fetcher.fetch('https://httpbin.org/status/500', { targetId });

      // Second failure (should open circuit)
      await fetcher.fetch('https://httpbin.org/status/500', { targetId });

      const stats = await breaker.getStats(targetId);
      expect(stats.state).toBe('open');
    });

    it('should skip requests when circuit is open', async () => {
      const targetId = 'test-skip-requests';

      // Trigger circuit open with failures
      await fetcher.fetch('https://httpbin.org/status/500', { targetId });
      await fetcher.fetch('https://httpbin.org/status/500', { targetId });

      // Next request should be skipped
      const result = await fetcher.fetch('https://httpbin.org/status/200', {
        targetId,
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('breaker_open');
      expect(result.status).toBeNull();
      expect(result.latencyMs).toBe(0);
      expect(result.success).toBe(false);
    });

    it('should close circuit after successful probe in half-open state', async () => {
      const targetId = 'test-circuit-close';

      // Open circuit
      await fetcher.fetch('https://httpbin.org/status/500', { targetId });
      await fetcher.fetch('https://httpbin.org/status/500', { targetId });

      // Wait for transition to half-open
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Successful probe should close circuit
      const result = await fetcher.fetch('https://httpbin.org/status/200', {
        targetId,
      });

      expect(result.success).toBe(true);
      // skipped is undefined when not skipped
      expect(result.skipped).toBeUndefined();

      const stats = await breaker.getStats(targetId);
      expect(stats.state).toBe('closed');
      expect(stats.failCount).toBe(0);
    });
  });

  describe('Latency Tracking', () => {
    it('should measure request latency', async () => {
      const result = await fetcher.fetch('https://httpbin.org/delay/1', {
        targetId: 'test-latency',
      });

      expect(result.latencyMs).toBeGreaterThanOrEqual(1000);
      expect(result.latencyMs).toBeLessThan(5000); // Increased timeout for network delays
    });

    it('should return zero latency for skipped requests', async () => {
      const targetId = 'test-skip-latency';

      // Open circuit
      await fetcher.fetch('https://httpbin.org/status/500', { targetId });
      await fetcher.fetch('https://httpbin.org/status/500', { targetId });

      // Skipped request
      const result = await fetcher.fetch('https://httpbin.org/status/200', {
        targetId,
      });

      expect(result.skipped).toBe(true);
      expect(result.latencyMs).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle network timeouts', async () => {
      const result = await fetcher.fetch('https://httpbin.org/delay/10', {
        targetId: 'test-timeout',
        timeoutMs: 1000,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy(); // Check error exists
      expect(result.error?.toLowerCase()).toMatch(/abort|timeout/i);
    });

    it('should record failure on timeout', async () => {
      const targetId = 'test-timeout-record';

      await fetcher.fetch('https://httpbin.org/delay/10', {
        targetId,
        timeoutMs: 1000,
      });

      const stats = await breaker.getStats(targetId);
      expect(stats.failCount).toBeGreaterThan(0);
    });
  });

  describe('Multiple Targets', () => {
    it('should track different targets independently', async () => {
      const target1 = 'target-1';
      const target2 = 'target-2';

      // Fail target 1
      await fetcher.fetch('https://httpbin.org/status/500', {
        targetId: target1,
      });
      await fetcher.fetch('https://httpbin.org/status/500', {
        targetId: target1,
      });

      // Succeed target 2
      await fetcher.fetch('https://httpbin.org/status/200', {
        targetId: target2,
      });

      const stats1 = await breaker.getStats(target1);
      const stats2 = await breaker.getStats(target2);

      expect(stats1.state).toBe('open');
      expect(stats2.state).toBe('closed');
    });
  });
});
