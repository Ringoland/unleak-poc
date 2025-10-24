import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { getStripeHealth, createMockIntent, handleWebhook } from '../../services/stripeService';
import { logger } from '../../utils/logger';

const router: RouterType = Router();

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const health = getStripeHealth();
    
    res.json(health);
  } catch (error) {
    logger.error('Stripe health check failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Health check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

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

    logger.error('Mock intent creation failed', {
      error: message,
      email: req.body.email ? '***@' + req.body.email.split('@')[1] : undefined,
      plan: req.body.plan,
    });

    return res.status(500).json({
      error: 'Mock intent creation failed',
      message,
    });
  }
});

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['stripe-signature'] as string | undefined;
    // req.body is Buffer when using express.raw()
    const rawBody = req.body;

    const result = await handleWebhook(rawBody, signature);

    // Always return 200 to prevent Stripe retries
    res.status(200).json(result);
  } catch (error) {
    logger.error('Webhook handling failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    // Still return 200 to prevent retries
    res.status(200).json({
      received: true,
      error: 'Internal processing failed (webhook acknowledged)',
    });
  }
});

export default router;
