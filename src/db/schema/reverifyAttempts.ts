import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { findings } from './findings';

export const reverifyAttempts = pgTable('reverify_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  findingId: uuid('finding_id')
    .references(() => findings.id, { onDelete: 'cascade' })
    .notNull(),
  jobId: varchar('job_id', { length: 100 }),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  ip: varchar('ip', { length: 45 }),
  userAgent: text('user_agent'),
  source: varchar('source', { length: 20 }).notNull().default('api'), // 'slack' | 'api'
  result: varchar('result', { length: 50 }), // 'ok' | 'duplicate' | 'rate_limited' | 'error'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const reverifyAttemptsRelations = relations(reverifyAttempts, ({ one }) => ({
  finding: one(findings, {
    fields: [reverifyAttempts.findingId],
    references: [findings.id],
  }),
}));

export type ReverifyAttempt = typeof reverifyAttempts.$inferSelect;
export type NewReverifyAttempt = typeof reverifyAttempts.$inferInsert;
