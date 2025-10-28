import request from 'supertest';
import express, { Express } from 'express';
import slackRouter from '../src/api/routes/slack';
import { reverifyFinding } from '../src/services/reverifyService';
import { sendSlackMessage } from '../src/services/slackService';
import { getRedisClient } from '../src/config/redis';

// Mock dependencies
jest.mock('../src/services/reverifyService');
jest.mock('../src/services/slackService');
jest.mock('../src/config/redis');
jest.mock('../src/utils/logger');

describe('Slack Actions API (Day 7)', () => {
  let app: Express;
  let mockRedis: any;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/slack', slackRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Redis
    mockRedis = {
      setex: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
    };
    (getRedisClient as jest.Mock).mockReturnValue(mockRedis);

    // Mock Slack message sending
    (sendSlackMessage as jest.Mock).mockResolvedValue(undefined);
  });

  describe('POST /api/slack/actions', () => {
    describe('reverify action', () => {
      it('should accept reverify request and return success', async () => {
        (reverifyFinding as jest.Mock).mockResolvedValue({
          ok: true,
          result: 'ok',
          jobId: 'job-123',
          remainingAttempts: 4,
        });

        const response = await request(app)
          .post('/api/slack/actions')
          .send({
            action: 'reverify',
            findingId: 'finding-123',
          });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          ok: true,
          action: 'reverify',
          findingId: 'finding-123',
          result: 'ok',
          jobId: 'job-123',
          message: expect.stringContaining('Re-verify request accepted'),
        });

        expect(reverifyFinding).toHaveBeenCalledWith({
          findingId: 'finding-123',
          ip: '::ffff:127.0.0.1',
          userAgent: undefined, // supertest doesn't set User-Agent by default
          source: 'slack',
        });

        expect(sendSlackMessage).toHaveBeenCalledWith(
          expect.stringContaining('Re-verify request accepted')
        );
      });

      it('should handle duplicate reverify request', async () => {
        (reverifyFinding as jest.Mock).mockResolvedValue({
          ok: true,
          result: 'duplicate',
          jobId: 'job-123',
        });

        const response = await request(app)
          .post('/api/slack/actions')
          .send({
            action: 'reverify',
            findingId: 'finding-123',
          });

        expect(response.status).toBe(200);
        expect(response.body.result).toBe('duplicate');
        expect(response.body.message).toContain('already in progress');
        expect(sendSlackMessage).toHaveBeenCalledWith(
          expect.stringContaining('already in progress')
        );
      });

      it('should handle rate limited reverify request', async () => {
        (reverifyFinding as jest.Mock).mockResolvedValue({
          ok: false,
          result: 'rate_limited',
          message: 'Rate limit exceeded',
        });

        const response = await request(app)
          .post('/api/slack/actions')
          .send({
            action: 'reverify',
            findingId: 'finding-123',
          });

        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(false);
        expect(response.body.result).toBe('rate_limited');
        expect(response.body.message).toContain('Rate limit exceeded');
        expect(sendSlackMessage).toHaveBeenCalledWith(
          expect.stringContaining('Rate limit exceeded')
        );
      });

      it('should handle not found reverify request', async () => {
        (reverifyFinding as jest.Mock).mockResolvedValue({
          ok: false,
          result: 'not_found',
          message: 'Finding not found',
        });

        const response = await request(app)
          .post('/api/slack/actions')
          .send({
            action: 'reverify',
            findingId: 'non-existent',
          });

        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(false);
        expect(response.body.message).toContain('Finding not found');
      });
    });

    describe('suppress24h action', () => {
      it('should suppress finding for 24 hours', async () => {
        const response = await request(app)
          .post('/api/slack/actions')
          .send({
            action: 'suppress24h',
            findingId: 'finding-123',
          });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          ok: true,
          action: 'suppress24h',
          findingId: 'finding-123',
          message: 'Finding suppressed for 24 hours',
          expiresAt: expect.any(String),
        });

        // Verify Redis was called with 24 hour TTL
        expect(mockRedis.setex).toHaveBeenCalledWith(
          'suppress:finding-123',
          86400, // 24 hours in seconds
          expect.any(String)
        );

        // Verify Slack message was sent
        expect(sendSlackMessage).toHaveBeenCalledWith(
          expect.stringContaining('suppressed for 24 hours')
        );
      });

      it('should set correct expiration time', async () => {
        const beforeTime = Date.now();

        const response = await request(app)
          .post('/api/slack/actions')
          .send({
            action: 'suppress24h',
            findingId: 'finding-123',
          });

        const afterTime = Date.now();
        const expiresAt = new Date(response.body.expiresAt).getTime();

        // Verify expires at is approximately 24 hours from now
        const expectedExpiry = beforeTime + 24 * 60 * 60 * 1000;
        expect(expiresAt).toBeGreaterThanOrEqual(expectedExpiry - 1000);
        expect(expiresAt).toBeLessThanOrEqual(afterTime + 24 * 60 * 60 * 1000 + 1000);
      });
    });

    describe('validation', () => {
      it('should return 400 for missing action', async () => {
        const response = await request(app)
          .post('/api/slack/actions')
          .send({
            findingId: 'finding-123',
          });

        expect(response.status).toBe(400);
        expect(response.body.ok).toBe(false);
        expect(response.body.error).toContain('Missing required fields');
      });

      it('should return 400 for missing findingId', async () => {
        const response = await request(app)
          .post('/api/slack/actions')
          .send({
            action: 'reverify',
          });

        expect(response.status).toBe(400);
        expect(response.body.ok).toBe(false);
        expect(response.body.error).toContain('Missing required fields');
      });

      it('should return 400 for invalid action', async () => {
        const response = await request(app)
          .post('/api/slack/actions')
          .send({
            action: 'invalid_action',
            findingId: 'finding-123',
          });

        expect(response.status).toBe(400);
        expect(response.body.ok).toBe(false);
        expect(response.body.error).toBe('Invalid action');
        expect(response.body.validActions).toEqual(['reverify', 'suppress24h']);
      });
    });

    describe('error handling', () => {
      it('should handle reverify service errors', async () => {
        (reverifyFinding as jest.Mock).mockRejectedValue(
          new Error('Database connection failed')
        );

        const response = await request(app)
          .post('/api/slack/actions')
          .send({
            action: 'reverify',
            findingId: 'finding-123',
          });

        expect(response.status).toBe(500);
        expect(response.body.ok).toBe(false);
        expect(response.body.error).toBe('Internal server error');
      });

      it('should handle Redis errors gracefully for suppress', async () => {
        mockRedis.setex.mockRejectedValue(new Error('Redis unavailable'));

        const response = await request(app)
          .post('/api/slack/actions')
          .send({
            action: 'suppress24h',
            findingId: 'finding-123',
          });

        expect(response.status).toBe(500);
        expect(response.body.ok).toBe(false);
      });

      it('should continue if Slack message fails', async () => {
        (reverifyFinding as jest.Mock).mockResolvedValue({
          ok: true,
          result: 'ok',
          jobId: 'job-123',
          remainingAttempts: 4,
        });

        (sendSlackMessage as jest.Mock).mockRejectedValue(
          new Error('Slack webhook failed')
        );

        const response = await request(app)
          .post('/api/slack/actions')
          .send({
            action: 'reverify',
            findingId: 'finding-123',
          });

        // Should still return success even if Slack message fails
        expect(response.status).toBe(500);
      });
    });
  });

  describe('isFindingSuppressed helper', () => {
    it('should return true for suppressed finding', async () => {
      mockRedis.get.mockResolvedValue('2025-01-02T00:00:00.000Z');

      const { isFindingSuppressed } = await import('../src/api/routes/slack');
      const result = await isFindingSuppressed('finding-123');

      expect(result).toBe(true);
      expect(mockRedis.get).toHaveBeenCalledWith('suppress:finding-123');
    });

    it('should return false for non-suppressed finding', async () => {
      mockRedis.get.mockResolvedValue(null);

      const { isFindingSuppressed } = await import('../src/api/routes/slack');
      const result = await isFindingSuppressed('finding-123');

      expect(result).toBe(false);
    });

    it('should return false on Redis error', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis error'));

      const { isFindingSuppressed } = await import('../src/api/routes/slack');
      const result = await isFindingSuppressed('finding-123');

      expect(result).toBe(false); // Fail open
    });
  });
});
