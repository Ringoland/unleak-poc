import { pgTable, uuid, varchar, timestamp, integer, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { findings } from './findings';

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    findingId: uuid('finding_id')
      .references(() => findings.id, { onDelete: 'cascade' })
      .notNull(),
    type: varchar('type', { length: 50 }).notNull(), // 'screenshot', 'har', 'html', 'console_logs'
    storageUrl: varchar('storage_url', { length: 1024 }).notNull(), // Local path or S3 URL
    size: integer('size').notNull(), // File size in bytes
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }), // Retention policy: 7 days
  },
  (table) => ({
    findingIdIdx: index('artifacts_finding_id_idx').on(table.findingId),
    typeIdx: index('artifacts_type_idx').on(table.type),
  })
);

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  finding: one(findings, {
    fields: [artifacts.findingId],
    references: [findings.id],
  }),
}));

export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
