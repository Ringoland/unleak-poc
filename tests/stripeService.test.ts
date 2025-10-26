/**
 * Stripe Service Tests
 * 
 * Unit tests for Stripe Lite service functionality
 */

import * as stripeService from '../src/services/stripeService';

// Mock dependencies
jest.mock('../src/utils/logger');
jest.mock('../src/db', () => ({
  db: {
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

describe('Stripe Service', () => {
  const originalEnv = process.env;
  const mockDb = require('../src/db').db;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getStripeHealth', () => {
    it('should return disabled when STRIPE_LITE_ENABLED is false', () => {
      process.env.STRIPE_LITE_ENABLED = 'false';
      process.env.STRIPE_API_KEY = '';

      const health = stripeService.getStripeHealth();

      expect(health.enabled).toBe(false);
      expect(health.keyPresent).toBe(false);
    });

    it('should return enabled when STRIPE_LITE_ENABLED is true', () => {
      process.env.STRIPE_LITE_ENABLED = 'true';
      process.env.STRIPE_API_KEY = 'sk_test_123';

      const health = stripeService.getStripeHealth();

      expect(health.enabled).toBe(true);
      expect(health.keyPresent).toBe(true);
    });

    it('should detect missing API key', () => {
      process.env.STRIPE_LITE_ENABLED = 'true';
      process.env.STRIPE_API_KEY = '';

      const health = stripeService.getStripeHealth();

      expect(health.enabled).toBe(true);
      expect(health.keyPresent).toBe(false);
    });

    it('should detect whitespace-only API key', () => {
      process.env.STRIPE_LITE_ENABLED = 'true';
      process.env.STRIPE_API_KEY = '   ';

      const health = stripeService.getStripeHealth();

      expect(health.enabled).toBe(true);
      expect(health.keyPresent).toBe(false);
    });
  });

  describe('createMockIntent', () => {
    beforeEach(() => {
      process.env.STRIPE_LITE_ENABLED = 'true';
      process.env.STRIPE_API_KEY = 'sk_test_123';
    });

    it('should throw error when Stripe is disabled', async () => {
      process.env.STRIPE_LITE_ENABLED = 'false';

      await expect(
        stripeService.createMockIntent({ email: 'test@example.com', plan: 'pro' })
      ).rejects.toThrow('Stripe Lite is disabled');
    });

    it('should generate mock intent ID', async () => {
      const result = await stripeService.createMockIntent({ email: 'user@test.com', plan: 'premium' });

      expect(result.ok).toBe(true);
      expect(result.id).toMatch(/^pi_mock_/);
      expect(result.plan).toBe('premium');
      expect(result.email).toBe('user@test.com');
    });

    it('should generate unique IDs', async () => {
      const result1 = await stripeService.createMockIntent({ email: 'test1@example.com' });
      const result2 = await stripeService.createMockIntent({ email: 'test2@example.com' });

      expect(result1.id).not.toBe(result2.id);
      expect(result1.id).toMatch(/^pi_mock_/);
      expect(result2.id).toMatch(/^pi_mock_/);
    });

    it('should call database insert', async () => {
      await stripeService.createMockIntent({ email: 'test@example.com', plan: 'basic' });

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.insert().values).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'mock_intent',
          plan: 'basic',
        })
      );
    });

    it('should handle missing email and plan', async () => {
      const result = await stripeService.createMockIntent({});

      expect(result.ok).toBe(true);
      expect(result.id).toMatch(/^pi_mock_/);
      expect(result.email).toBeUndefined();
      expect(result.plan).toBeUndefined();
    });

    it('should continue on database error', async () => {
      mockDb.insert().values.mockRejectedValueOnce(new Error('DB error'));

      const result = await stripeService.createMockIntent({ email: 'test@example.com' });

      // Should succeed despite DB error
      expect(result.ok).toBe(true);
      expect(result.id).toMatch(/^pi_mock_/);
    });
  });

  describe('handleWebhook', () => {
    beforeEach(() => {
      process.env.STRIPE_LITE_ENABLED = 'true';
      process.env.STRIPE_API_KEY = 'sk_test_123';
    });

    it('should always return success', async () => {
      const payload = JSON.stringify({ type: 'payment_intent.succeeded' });
      const result = await stripeService.handleWebhook(payload, undefined);

      expect(result.received).toBe(true);
    });

    it('should call database insert', async () => {
      const payload = JSON.stringify({ type: 'charge.succeeded', id: 'evt_123' });
      await stripeService.handleWebhook(payload, undefined);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.insert().values).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'webhook',
        })
      );
    });

    it('should handle webhook with signature', async () => {
      const signature = 't=1234567890,v1=test_signature';
      const payload = JSON.stringify({ type: 'payment_intent.created' });
      const result = await stripeService.handleWebhook(payload, signature);

      expect(result.received).toBe(true);
    });

    it('should handle webhook without signature', async () => {
      const payload = JSON.stringify({ type: 'customer.created' });
      const result = await stripeService.handleWebhook(payload, undefined);

      expect(result.received).toBe(true);
    });

    it('should handle minimal event payload', async () => {
      const payload = JSON.stringify({});
      const result = await stripeService.handleWebhook(payload, undefined);

      expect(result.received).toBe(true);
    });

    it('should handle complex event payload', async () => {
      const complexEvent = {
        id: 'evt_complex_123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_123',
            amount: 5000,
            currency: 'usd',
            metadata: { plan: 'enterprise' },
          },
        },
      };

      const payload = JSON.stringify(complexEvent);
      const result = await stripeService.handleWebhook(payload, 't=123,v1=sig');

      expect(result.received).toBe(true);
    });

    it('should continue on database error', async () => {
      mockDb.insert().values.mockRejectedValueOnce(new Error('DB connection lost'));

      const payload = JSON.stringify({ type: 'invoice.paid' });
      const result = await stripeService.handleWebhook(payload, undefined);

      // Should succeed despite DB error
      expect(result.received).toBe(true);
    });
  });
});
