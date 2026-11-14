import { doublePrecision, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export interface Contact {
  name: string;
  phone: string;
  role?: string;
}

export const places = pgTable('places', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: text('external_id').unique(),
  name: text('name').notNull(),
  kind: text('kind'),
  address: text('address'),
  lat: doublePrecision('lat'),
  lon: doublePrecision('lon'),
  timezone: text('timezone'),
  workingHours: text('working_hours'),
  contacts: jsonb('contacts').$type<Contact[]>().notNull().default([]),
  /** Permanent instructions, copied into every stage at this place. */
  instructions: jsonb('instructions').$type<unknown[]>().notNull().default([]),
  tags: text('tags').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: text('external_id').unique(),
  name: text('name').notNull(),
  contacts: jsonb('contacts').$type<Contact[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
