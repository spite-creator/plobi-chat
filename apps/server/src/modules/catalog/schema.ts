import { boolean, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const CATALOG_KINDS = [
  'stage_type',
  'event_type',
  'incident_type',
  'requirement_template',
  'requirement_rule',
  'instruction_rule',
] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

/**
 * One row per catalog entry. The definition is a JSON document validated by
 * the core types, so new fields in the core do not require migrations.
 */
export const catalogItems = pgTable(
  'catalog_items',
  {
    kind: text('kind', { enum: CATALOG_KINDS }).notNull(),
    code: text('code').notNull(),
    data: jsonb('data').notNull(),
    /** Shipped with the product: may be changed or hidden, never deleted. */
    isSystem: boolean('is_system').notNull().default(false),
    hidden: boolean('hidden').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.code] })],
);
