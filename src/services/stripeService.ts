import { db } from '../db';
import { stripeEvents } from '../db/schema';
import { logger } from '../utils/logger';
import { redactObject } from '../utils/redact';
import crypto from 'crypto';
import Stripe from 'stripe';

interface StripeHealthResponse {
  enabled: boolean;
  keyPresent: boolean;
}

interface MockIntentRequest {
  email?: string;
  plan?: string;
}

interface MockIntentResponse {
  ok: boolean;
  id: string;
  plan?: string;
  email?: string;
}

interface WebhookResponse {
  received: boolean;
}

/**
 * Check Stripe Lite health status
 */
export function getStripeHealth(): StripeHealthResponse {
  const enabled = process.env.STRIPE_LITE_ENABLED === 'true';
  const keyPresent = Boolean(process.env.STRIPE_API_KEY && process.env.STRIPE_API_KEY.trim() !== '');

  return {
    enabled,
    keyPresent,
  };
}

/**
 * Create a mock payment intent (no real charge)
 * Returns a fake payment intent ID and logs to audit table
 * NO REAL STRIPE CALLS - just synthesizes an ID and writes audit row
 */
export async function createMockIntent(request: MockIntentRequest): Promise<MockIntentResponse> {
  const health = getStripeHealth();

  if (!health.enabled) {
    throw new Error('Stripe Lite is disabled. Set STRIPE_LITE_ENABLED=true to enable.');
  }

  // Generate a fake payment intent ID (NO REAL STRIPE API CALL)
  const paymentId = `pi_mock_${crypto.randomBytes(12).toString('hex')}`;

  // Prepare response
  const response: MockIntentResponse = {
    ok: true,
    id: paymentId,
    plan: request.plan,
    email: request.email,
  };

  // Redact PII before storing - use redactObject helper
  const redactedPayload = redactObject(request);

  // Persist audit event (no side effects, just logging)
  try {
    await db.insert(stripeEvents).values({
      eventType: 'mock_intent',
      paymentId,
      plan: request.plan || null,
      payload: redactedPayload,
    });

    // Clean logs: no emails, no keys, just plan
    logger.info('stripe.mock_intent ok', {
      plan: request.plan || 'none',
    });
  } catch (error) {
    logger.error('stripe.mock_intent failed to persist audit', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Continue - don't fail the request due to audit logging
  }

  return response;
}

/**
 * Validate Stripe webhook signature
 * Only validates if STRIPE_WEBHOOK_SECRET is set
 * Returns the parsed event if valid, or null if invalid/skipped
 */
function validateWebhookSignature(
  payload: string | Buffer,
  signature: string
): any | null {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Skip validation if no webhook secret configured
  if (!webhookSecret || !webhookSecret.trim()) {
    return null;
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_API_KEY || '', {
      apiVersion: '2025-09-30.clover',
    });

    // Use Stripe's official webhook signature verification
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret
    );

    return event;
  } catch (error) {
    // Log failure but don't expose details
    logger.error('stripe.webhook signature validation failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

/**
 * Handle Stripe webhook (NO SIDE EFFECTS)
 * Acknowledges receipt (200) and exits without state changes
 * Verifies signature only if STRIPE_WEBHOOK_SECRET is set
 * Always returns 200 {received:true}
 */
export async function handleWebhook(
  rawPayload: string | Buffer,
  signature?: string
): Promise<WebhookResponse> {
  let verifiedEvent: any = null;
  let payload: any;

  // Validate signature only if STRIPE_WEBHOOK_SECRET is present
  if (signature && process.env.STRIPE_WEBHOOK_SECRET) {
    verifiedEvent = validateWebhookSignature(rawPayload, signature);
    
    if (verifiedEvent) {
      payload = verifiedEvent;
    } else {
      // Validation failed, but still parse payload for logging
      try {
        payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
      } catch {
        payload = {};
      }
    }
  } else {
    // No signature or no webhook secret - parse payload directly
    try {
      payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
    } catch {
      payload = {};
    }
  }

  // Clean log: no emails, no keys - just type and verification status
  logger.info('stripe.webhook received', {
    type: payload?.type || 'unknown',
    verified: Boolean(verifiedEvent),
  });

  // Persist audit event (no side effects, just logging)
  // Only if STRIPE_LITE_ENABLED is true
  if (process.env.STRIPE_LITE_ENABLED === 'true') {
    try {
      const redactedPayload = redactObject(payload);
      
      await db.insert(stripeEvents).values({
        eventType: 'webhook',
        paymentId: payload?.id || `wh_mock_${crypto.randomBytes(8).toString('hex')}`,
        plan: payload?.data?.object?.metadata?.plan || null,
        payload: redactedPayload,
      });
    } catch (error) {
      // Log error but don't fail - webhook must always return 200
      logger.error('stripe.webhook audit persist failed', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  // Always return 200 to prevent Stripe retries (NO STATE CHANGES)
  return { received: true };
}

export default {
  getStripeHealth,
  createMockIntent,
  handleWebhook,
};
