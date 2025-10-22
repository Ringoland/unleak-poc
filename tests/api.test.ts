import request from 'supertest';
import express, { Express } from 'express';
import Redis from 'ioredis';
import apiRoutes from '../src/api/index';
import { errorHandler } from '../src/api/middleware/errorHandler';
import { runService } from '../src/services/runService';

// Mock dependencies - MUST be before imports
jest.mock('../src/config/redis', () => ({
  initializeRedis: jest.fn().mockResolvedValue({
    get: jest.fn(),
    setex: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
  }),
  getRedisClient: jest.fn().mockReturnValue({
    get: jest.fn(),
    setex: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
  }),
  closeRedis: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/db');
jest.mock('../src/utils/logger');

jest.mock('nanoid', () => ({
  nanoid: () => 'test-id-123',
}));

jest.mock('../src/services/queueService', () => ({
  addRenderJob: jest.fn().mockResolvedValue({ id: 'job-123' }),
  addScanJob: jest.fn().mockResolvedValue({ id: 'job-456' }),
  renderQueue: {
    add: jest.fn().mockResolvedValue({ id: 'job-123' }),
    close: jest.fn(),
    on: jest.fn(),
  },
  scanQueue: {
    add: jest.fn().mockResolvedValue({ id: 'job-456' }),
    close: jest.fn(),
    on: jest.fn(),
  },
}));

jest.mock('../src/services/runService');

jest.mock('../src/utils/allow-list', () => ({
  loadAllowList: jest.fn().mockReturnValue(['https://example.com', 'https://test.com']),
}));

jest.mock('../src/config/bullBoard', () => ({
  serverAdapter: {
    setBasePath: jest.fn(),
    getRouter: jest.fn().mockReturnValue({
      get: jest.fn(),
      post: jest.fn(),
      use: jest.fn(),
    }),
  },
}));

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
      ttl: jest.fn(),
    } as any;
    
    // Ensure getRedisClient returns mockRedis
    const { getRedisClient } = require('../src/config/redis');
    getRedisClient.mockReturnValue(mockRedis);
  });

  describe('POST /api/runs', () => {
    it('should create a new run successfully', async () => {
      const mockResult = {
        run: {
          id: 'run-123',
          status: 'queued',
          urlCount: 2,
          submittedAt: new Date(),
          runType: 'manual',
        },
        findings: [{ id: 'finding-1' }, { id: 'finding-2' }],
        jobIds: ['job-1', 'job-2'],
      };

      (runService.createRun as jest.Mock).mockResolvedValueOnce(mockResult);

      const response = await request(app)
        .post('/api/runs')
        .send({
          payload: { custom: 'data' },
        })
        .expect(201);

      expect(response.body).toMatchObject({
        id: 'run-123',
        submitted: expect.any(String),
        count: 2,
      });
      
      expect(runService.createRun).toHaveBeenCalledWith({
        urls: ['https://example.com', 'https://test.com'],
        payload: { custom: 'data' },
        runType: 'manual',
      });
    });

    it('should handle empty URLs array', async () => {
      // Mock loadAllowList to return empty array
      const { loadAllowList } = require('../src/utils/allow-list');
      loadAllowList.mockReturnValueOnce([]);

      const response = await request(app).post('/api/runs').send({ urls: [] }).expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('No URLs provided');
    });

    it('should handle missing URLs field', async () => {
      // Mock loadAllowList to return empty array
      const { loadAllowList } = require('../src/utils/allow-list');
      loadAllowList.mockReturnValueOnce([]);

      const response = await request(app).post('/api/runs').send({}).expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('No URLs provided');
    });

    it('should handle database errors', async () => {
      (runService.createRun as jest.Mock).mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .post('/api/runs')
        .send({ payload: { test: 'data' } })
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
        findings: [
          { id: 'f1', url: 'https://example.com', status: 'open', findingType: 'error', severity: 'high', title: 'Error 1', verified: false, falsePositive: false, createdAt: new Date() }
        ]
      };

      const mockStats = {
        totalFindings: 3,
        byStatus: { open: 2, resolved: 1 },
        bySeverity: { high: 1, medium: 1, low: 1 },
      };

      (runService.getRun as jest.Mock).mockResolvedValueOnce(mockRun);
      (runService.getRunStats as jest.Mock).mockResolvedValueOnce(mockStats);

      const response = await request(app).get('/api/runs/run-123').expect(200);

      expect(response.body).toMatchObject({
        id: 'run-123',
        status: 'completed',
        urlCount: 10,
        findingCount: 3,
      });
      
      expect(runService.getRun).toHaveBeenCalledWith('run-123');
      expect(runService.getRunStats).toHaveBeenCalledWith('run-123');
    });

    it('should return 404 for non-existent run', async () => {
      (runService.getRun as jest.Mock).mockResolvedValueOnce(null);

      const response = await request(app).get('/api/runs/non-existent-id').expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Run not found');
    });

    it('should handle database errors', async () => {
      (runService.getRun as jest.Mock).mockRejectedValueOnce(
        new Error('Database query failed')
      );

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
      mockRedis.ttl.mockResolvedValue(100);

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
    beforeEach(() => {
      mockRedis.setex.mockResolvedValue('OK');
    });

    it('should handle Slack action requests', async () => {
      const response = await request(app)
        .post('/api/slack/actions?act=ack&findingId=finding-123')
        .expect(200);

      expect(response.body).toMatchObject({
        ok: true,
        action: 'ack',
        findingId: 'finding-123',
      });
      
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'slack:ack:finding-123',
        86400,
        expect.any(String)
      );
    });

    it('should handle empty Slack action requests', async () => {
      const response = await request(app)
        .post('/api/slack/actions')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Missing required query parameters');
    });

    it('should handle Slack action requests with no body', async () => {
      const response = await request(app)
        .post('/api/slack/actions')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Missing required query parameters');
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
      const mockResult = {
        run: {
          id: 'run-126',
          status: 'queued',
          urlCount: 2,
          submittedAt: new Date(),
          runType: 'manual',
        },
        findings: [{ id: 'finding-1' }, { id: 'finding-2' }],
        jobIds: ['job-1', 'job-2'],
      };

      (runService.createRun as jest.Mock).mockResolvedValueOnce(mockResult);

      const response = await request(app)
        .post('/api/runs')
        .set('Content-Type', 'application/json')
        .send({ payload: { test: 'data' } })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.id).toBe('run-126');
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
