import { pgTable, uuid, varchar, timestamp, jsonb } from 'drizzle-orm/pg-core';

/**
 * Stripe Events
 * 
 * Audit log for non-transactional Stripe Lite flows.
 * Used to track mock payment intents and webhooks without creating real charges.
 * PII is redacted on write.
 */
export const stripeEvents = pgTable('stripe_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: varchar('event_type', { length: 100 }).notNull(), // 'mock_intent', 'webhook'
  paymentId: varchar('payment_id', { length: 100 }).notNull(), // fake payment intent ID
  plan: varchar('plan', { length: 50 }),
  payload: jsonb('payload').notNull(), // Redacted payload (no raw PII)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Type exports for TypeScript
export type StripeEvent = typeof stripeEvents.$inferSelect;
export type NewStripeEvent = typeof stripeEvents.$inferInsert;
