import { db } from '../db';
import { stripeEvents } from '../db/schema';
import { logger } from '../utils/logger';
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
 * Redact PII from payload for audit logging
 */
function redactPII(payload: any): any {
  const redacted = { ...payload };
  
  // Redact email - keep domain for debugging
  if (redacted.email) {
    const [, domain] = redacted.email.split('@');
    redacted.email = domain ? `***@${domain}` : '***@***';
  }

  // Redact any other sensitive fields
  if (redacted.card) {
    redacted.card = '[REDACTED]';
  }
  if (redacted.payment_method) {
    redacted.payment_method = '[REDACTED]';
  }

  return redacted;
}

/**
 * Create a mock payment intent (no real charge)
 * Returns a fake payment intent ID and logs to audit table
 */
export async function createMockIntent(request: MockIntentRequest): Promise<MockIntentResponse> {
  const health = getStripeHealth();

  if (!health.enabled) {
    throw new Error('Stripe Lite is disabled. Set STRIPE_LITE_ENABLED=true to enable.');
  }

  // Generate a fake payment intent ID
  const paymentId = `pi_mock_${crypto.randomBytes(12).toString('hex')}`;

  // Prepare response
  const response: MockIntentResponse = {
    ok: true,
    id: paymentId,
    plan: request.plan,
    email: request.email,
  };

  // Redact PII before storing
  const redactedPayload = redactPII(request);

  // Persist audit event
  try {
    await db.insert(stripeEvents).values({
      eventType: 'mock_intent',
      paymentId,
      plan: request.plan || null,
      payload: redactedPayload,
    });

    logger.info('Created mock payment intent', {
      paymentId,
      plan: request.plan,
      emailDomain: request.email ? request.email.split('@')[1] : undefined,
    });
  } catch (error) {
    logger.error('Failed to persist mock intent audit event', {
      error: error instanceof Error ? error.message : String(error),
      paymentId,
    });
    // Continue - don't fail the request due to audit logging
  }

  return response;
}

/**
 * Validate Stripe webhook signature
 * Returns the parsed event if valid, or null if invalid
 */
function validateWebhookSignature(
  payload: string | Buffer,
  signature: string
): any | null {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret || !webhookSecret.trim()) {
    logger.info('Webhook signature validation skipped (no webhook secret configured)');
    return null; // Skip validation if no webhook secret
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

    logger.info('Webhook signature validation succeeded', {
      eventType: event.type,
      eventId: event.id,
    });

    return event;
  } catch (error) {
    logger.error('Webhook signature validation failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Handle Stripe webhook (no side effects)
 * Always returns 200 {received:true} to prevent retries
 */
export async function handleWebhook(
  rawPayload: string | Buffer,
  signature?: string
): Promise<WebhookResponse> {
  const health = getStripeHealth();
  let verifiedEvent: any = null;
  let payload: any;

  // Validate signature if webhook secret is configured
  if (signature && process.env.STRIPE_WEBHOOK_SECRET) {
    verifiedEvent = validateWebhookSignature(rawPayload, signature);
    
    if (!verifiedEvent) {
      logger.warn('Webhook signature validation failed, but returning 200 to prevent retries');
      // Parse the raw payload manually as fallback
      payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
    } else {
      // Use the verified event
      payload = verifiedEvent;
    }
  } else {
    // No signature validation - parse payload directly
    if (!signature) {
      logger.info('Webhook received without signature header');
    } else {
      logger.info('Webhook signature validation skipped (no webhook secret configured)');
    }
    payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
  }

  // Log webhook receipt
  logger.info('Stripe webhook received', {
    enabled: health.enabled,
    verified: Boolean(verifiedEvent),
    type: payload?.type,
    id: payload?.id,
  });

  // Persist audit event if enabled
  if (health.enabled) {
    try {
      const redactedPayload = redactPII(payload);
      
      await db.insert(stripeEvents).values({
        eventType: 'webhook',
        paymentId: payload?.id || `wh_mock_${crypto.randomBytes(8).toString('hex')}`,
        plan: payload?.data?.object?.metadata?.plan || null,
        payload: redactedPayload,
      });

      logger.info('Webhook audit event persisted');
    } catch (error) {
      logger.error('Failed to persist webhook audit event', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue - don't fail the webhook due to audit logging
    }
  }

  // Always return 200 to prevent Stripe retries
  return { received: true };
}

export default {
  getStripeHealth,
  createMockIntent,
  handleWebhook,
};
