import { pgTable, serial, uuid, timestamp, integer, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { findings } from './findings';

export const reverifyCounters = pgTable('reverify_counters', {
  id: serial('id').primaryKey(),  
  findingId: uuid('finding_id').notNull().references(() => findings.id, { onDelete: 'cascade' }),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
  requestCount: integer('request_count').notNull().default(0),
  lastRequestAt: timestamp('last_request_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  findingWindowIdx: index('reverify_counters_finding_window_idx').on(
    table.findingId, 
    table.windowStart, 
    table.windowEnd
  ),
  windowEndIdx: index('reverify_counters_window_end_idx').on(table.windowEnd),
}));

export const reverifyCountersRelations = relations(reverifyCounters, ({ one }) => ({
  finding: one(findings, {
    fields: [reverifyCounters.findingId],
    references: [findings.id],
  }),
}));

export type ReverifyCounter = typeof reverifyCounters.$inferSelect;
export type NewReverifyCounter = typeof reverifyCounters.$inferInsert;
