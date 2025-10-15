import { pgTable, varchar, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { findings } from './findings';

export const reverifyKeys = pgTable('reverify_keys', {
  idempotencyKey: varchar('idempotency_key', { length: 255 }).primaryKey(),
  findingId: uuid('finding_id').notNull().references(() => findings.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 50 }).notNull().default('accepted'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  expiresAtIdx: index('reverify_keys_expires_at_idx').on(table.expiresAt),
  findingIdIdx: index('reverify_keys_finding_id_idx').on(table.findingId),
}));

export const reverifyKeysRelations = relations(reverifyKeys, ({ one }) => ({
  finding: one(findings, {
    fields: [reverifyKeys.findingId],
    references: [findings.id],
  }),
}));

// Type exports for TypeScript
export type ReverifyKey = typeof reverifyKeys.$inferSelect;
export type NewReverifyKey = typeof reverifyKeys.$inferInsert;
