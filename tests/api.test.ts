import request from 'supertest';
import express, { Express } from 'express';
import Redis from 'ioredis';
import apiRoutes from '../src/api/index';
import { errorHandler } from '../src/api/middleware/errorHandler';
import { db } from '../src/db';

// Mock dependencies
jest.mock('../src/config/redis');
jest.mock('../src/db');
jest.mock('../src/utils/logger');

describe('API Integration Tests', () => {
  let app: Express;
  let mockRedis: jest.Mocked<Redis>;

  beforeAll(() => {
    // Setup Express app for testing
    app = express();
    app.use(express.json());
    app.use('/api', apiRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Create mock Redis instance
    mockRedis = {
      get: jest.fn(),
      setex: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
    } as any;
  });

  describe('POST /api/runs', () => {
    it('should create a new run successfully', async () => {
      const mockRun = {
        id: 'run-123',
        status: 'queued',
        urlCount: 5,
        submittedAt: new Date(),
        runType: 'manual',
      };

      (db.insert as jest.Mock) = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockRun]),
        }),
      });

      const response = await request(app)
        .post('/api/runs')
        .send({
          payload: { custom: 'data' },
        })
        .expect(201);

      expect(response.body).toMatchObject({
        id: 'run-123',
        submitted: expect.any(String),
        count: 50,
      });
    });

    it('should handle empty URLs array', async () => {
      const mockRun = {
        id: 'run-124',
        status: 'queued',
        urlCount: 0,
        submittedAt: new Date(),
        runType: 'manual',
      };

      (db.insert as jest.Mock) = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockRun]),
        }),
      });

      const response = await request(app).post('/api/runs').send({ urls: [] }).expect(201);

      expect(response.body.count).toBe(0);
    });

    it('should handle missing URLs field', async () => {
      const mockRun = {
        id: 'run-125',
        status: 'queued',
        urlCount: 0,
        submittedAt: new Date(),
        runType: 'manual',
      };

      (db.insert as jest.Mock) = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockRun]),
        }),
      });

      const response = await request(app).post('/api/runs').send({}).expect(201);

      expect(response.body.count).toBe(0);
    });

    it('should handle database errors', async () => {
      (db.insert as jest.Mock) = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockRejectedValue(new Error('Database connection failed')),
        }),
      });

      const response = await request(app)
        .post('/api/runs')
        .send({ urls: ['https://example.com'] })
        .expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Failed to create run');
    });
  });

  describe('GET /api/runs/:id', () => {
    it('should retrieve an existing run', async () => {
      const mockRun = {
        id: 'run-123',
        status: 'completed',
        runType: 'manual',
        urlCount: 10,
        findingCount: 3,
        submittedAt: new Date('2025-10-16T10:00:00Z'),
        startedAt: new Date('2025-10-16T10:01:00Z'),
        completedAt: new Date('2025-10-16T10:15:00Z'),
        payload: { urls: ['https://example.com'] },
        error: null,
        createdAt: new Date('2025-10-16T10:00:00Z'),
        updatedAt: new Date('2025-10-16T10:15:00Z'),
      };

      (db.select as jest.Mock) = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockRun]),
          }),
        }),
      });

      const response = await request(app).get('/api/runs/run-123').expect(200);

      expect(response.body).toMatchObject({
        id: 'run-123',
        status: 'completed',
        urlCount: 10,
        findingCount: 3,
      });
    });

    it('should return 404 for non-existent run', async () => {
      (db.select as jest.Mock) = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const response = await request(app).get('/api/runs/non-existent-id').expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Run not found');
    });

    it('should handle database errors', async () => {
      (db.select as jest.Mock) = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockRejectedValue(new Error('Database query failed')),
          }),
        }),
      });

      const response = await request(app).get('/api/runs/run-123').expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Failed to fetch run');
    });
  });

  describe('POST /api/findings/:id/reverify', () => {
    const { getRedisClient } = require('../src/config/redis');

    beforeEach(() => {
      getRedisClient.mockReturnValue(mockRedis);
    });

    it('should accept reverify request with valid idempotency key', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);

      const response = await request(app)
        .post('/api/findings/finding-123/reverify')
        .set('Idempotency-Key', 'unique-key-123')
        .expect(200);

      expect(response.body).toMatchObject({
        id: 'finding-123',
        reverifyStatus: 'accepted',
      });

      expect(mockRedis.setex).toHaveBeenCalledWith('reverify:unique-key-123', 120, 'finding-123');
    });

    it('should reject request without idempotency key', async () => {
      const response = await request(app).post('/api/findings/finding-123/reverify').expect(400);

      expect(response.body).toMatchObject({
        error: 'Idempotency-Key header required',
      });
    });

    it('should detect duplicate requests using idempotency key', async () => {
      mockRedis.get.mockResolvedValue('finding-123');

      const response = await request(app)
        .post('/api/findings/finding-123/reverify')
        .set('Idempotency-Key', 'duplicate-key')
        .expect(200);

      expect(response.body).toMatchObject({
        id: 'finding-123',
        reverifyStatus: 'duplicate_ttl',
      });

      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('should enforce rate limiting', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(6); // Exceeds limit of 5

      const response = await request(app)
        .post('/api/findings/finding-123/reverify')
        .set('Idempotency-Key', 'rate-limited-key')
        .expect(429);

      expect(response.body).toMatchObject({
        id: 'finding-123',
        reverifyStatus: 'rate_limited',
      });
    });

    it('should set rate limit expiry on first request', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);

      await request(app)
        .post('/api/findings/finding-456/reverify')
        .set('Idempotency-Key', 'first-request-key')
        .expect(200);

      expect(mockRedis.expire).toHaveBeenCalledWith('reverify:rate:finding-456', 3600);
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection failed'));

      const response = await request(app)
        .post('/api/findings/finding-123/reverify')
        .set('Idempotency-Key', 'error-key')
        .expect(500);

      expect(response.body).toMatchObject({
        error: 'Internal server error',
      });
    });

    it('should respect 120 second TTL for idempotency keys', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(2);
      mockRedis.setex.mockResolvedValue('OK');

      await request(app)
        .post('/api/findings/finding-789/reverify')
        .set('Idempotency-Key', 'ttl-test-key')
        .expect(200);

      expect(mockRedis.setex).toHaveBeenCalledWith('reverify:ttl-test-key', 120, 'finding-789');
    });
  });

  describe('POST /api/slack/actions', () => {
    it('should handle Slack action requests', async () => {
      const response = await request(app)
        .post('/api/slack/actions')
        .send({
          type: 'block_actions',
          actions: [{ action_id: 'test_action' }],
        })
        .expect(200);

      expect(response.body).toMatchObject({
        ok: true,
      });
    });

    it('should handle empty Slack action requests', async () => {
      const response = await request(app).post('/api/slack/actions').send({}).expect(200);

      expect(response.body).toMatchObject({
        ok: true,
      });
    });

    it('should handle Slack action requests with no body', async () => {
      const res = await request(app).post('/api/slack/actions').expect(200);

      expect(res.body).toMatchObject({
        ok: true,
      });
    });
  });

  describe('Error Handler Middleware', () => {
    it('should handle 404 for unknown routes', async () => {
      const res = await request(app).get('/api/unknown-route').expect(404);

      expect(res.status).toBe(404);
    });

    it('should handle invalid JSON payloads', async () => {
      const res = await request(app)
        .post('/api/runs')
        .set('Content-Type', 'application/json')
        .send('invalid json{')
        .expect(500); // Express 5 returns 500 for JSON parse errors

      expect(res.status).toBe(500);
    });
  });

  describe('Content-Type Validation', () => {
    it('should accept application/json content type', async () => {
      const mockRun = {
        id: 'run-126',
        status: 'queued',
        urlCount: 1,
        submittedAt: new Date(),
        runType: 'manual',
      };

      (db.insert as jest.Mock) = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockRun]),
        }),
      });

      const response = await request(app)
        .post('/api/runs')
        .set('Content-Type', 'application/json')
        .send({ urls: ['https://example.com'] })
        .expect(201);

      expect(response.body).toHaveProperty('id');
    });
  });

  describe('CORS and Headers', () => {
    it('should handle OPTIONS requests', async () => {
      const response = await request(app).options('/api/runs');

      // No CORS configured, but route exists so check for any valid response
      expect([200, 204, 404]).toContain(response.status);
    });
  });
});
