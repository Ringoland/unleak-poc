import { pgTable, serial, varchar, timestamp, integer, boolean } from 'drizzle-orm/pg-core';

export const breakerStates = pgTable('breaker_states', {
  id: serial('id').primaryKey(),
  serviceName: varchar('service_name', { length: 255 }).notNull().unique(),
  state: varchar('state', { length: 50 }).notNull().default('closed'),
  failureCount: integer('failure_count').notNull().default(0),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  lastError: varchar('last_error', { length: 1024 }),
  successCount: integer('success_count').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type BreakerState = typeof breakerStates.$inferSelect;
export type NewBreakerState = typeof breakerStates.$inferInsert;
