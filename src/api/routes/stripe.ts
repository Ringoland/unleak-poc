import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { getStripeHealth, createMockIntent, handleWebhook } from '../../services/stripeService';
import { logger } from '../../utils/logger';
import express from 'express';

const router: RouterType = Router();

/**
 * GET /api/stripe/health
 * Returns Stripe Lite status and key presence
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const health = getStripeHealth();
    
    res.json(health);
  } catch (error) {
    logger.error('stripe.health check failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    res.status(500).json({
      error: 'Health check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/stripe/mock-intent
 * Creates mock payment intent (NO REAL STRIPE CALLS)
 * Only synthesizes an ID and writes a redacted audit row
 * Only works if STRIPE_LITE_ENABLED=true
 */
router.post('/mock-intent', async (req: Request, res: Response) => {
  try {
    const { email, plan } = req.body;

    const result = await createMockIntent({ email, plan });

    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    // If Stripe is disabled, return 403
    if (message.includes('disabled')) {
      return res.status(403).json({
        error: 'Stripe Lite disabled',
        message,
      });
    }

    // Clean log - no emails, no keys
    logger.error('stripe.mock_intent failed', {
      error: message,
      plan: req.body.plan || 'none',
    });

    return res.status(500).json({
      error: 'Mock intent creation failed',
      message,
    });
  }
});

/**
 * POST /api/stripe/webhook
 * Handles Stripe webhooks (NO SIDE EFFECTS)
 * Verifies signature only if STRIPE_WEBHOOK_SECRET is set
 * Always returns 200 {received:true}
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const signature = req.headers['stripe-signature'] as string | undefined;
    // req.body is Buffer when using express.raw()
    const rawBody = req.body;

    const result = await handleWebhook(rawBody, signature);

    // Always return 200 to prevent Stripe retries
    res.status(200).json(result);
  } catch (error) {
    // Clean log - no sensitive data
    logger.error('stripe.webhook handling failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    // Still return 200 to prevent retries (NO STATE CHANGES)
    res.status(200).json({
      received: true,
      error: 'Internal processing failed (webhook acknowledged)',
    });
  }
});

export default router;
