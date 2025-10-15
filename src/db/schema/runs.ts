import { pgTable, uuid, varchar, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { findings } from './findings';

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: varchar('status', { length: 50 }).notNull().default('queued'),
  runType: varchar('run_type', { length: 50 }).notNull().default('scheduled'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  urlCount: integer('url_count').notNull().default(0),
  findingCount: integer('finding_count').notNull().default(0),
  payload: jsonb('payload'),
  error: jsonb('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const runsRelations = relations(runs, ({ many }) => ({
  findings: many(findings),
}));

// Type exports for TypeScript
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
