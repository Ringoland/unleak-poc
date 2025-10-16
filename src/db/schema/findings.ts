import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  boolean,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { runs } from './runs';

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
    url: varchar('url', { length: 2048 }).notNull(),
    status: varchar('status', { length: 50 }).notNull().default('pending'),
    findingType: varchar('finding_type', { length: 100 }),
    severity: varchar('severity', { length: 20 }),
    title: varchar('title', { length: 512 }),
    description: text('description'),
    detectedValue: text('detected_value'),
    context: text('context'),
    fingerprint: varchar('fingerprint', { length: 512 }),
    falsePositive: boolean('false_positive').notNull().default(false),
    verified: boolean('verified').notNull().default(false),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    fingerprintIdx: index('findings_fingerprint_idx').on(table.fingerprint),
    runIdIdx: index('findings_run_id_idx').on(table.runId),
  })
);

export const findingsRelations = relations(findings, ({ one }) => ({
  run: one(runs, {
    fields: [findings.runId],
    references: [runs.id],
  }),
}));

export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
