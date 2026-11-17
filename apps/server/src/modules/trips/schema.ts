import type { Attachment, StageRequirement } from '@plobi/core';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: text('external_id').unique(),
  number: text('number').notNull(),
  driverId: uuid('driver_id'),
  dispatcherId: uuid('dispatcher_id'),
  tags: text('tags').array().notNull().default([]),
  vehicle: jsonb('vehicle').$type<Record<string, unknown>>().notNull().default({}),
  cargo: jsonb('cargo').$type<Record<string, unknown>>().notNull().default({}),
  customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Stage details that the engine does not need: address, window, contact, ... */
export interface StageDetails {
  address?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  windowFrom?: string;
  windowTo?: string;
  contact?: { name: string; phone: string };
  carrierRef?: string;
  plannedDistanceKm?: number;
}

export const stages = pgTable(
  'stages',
  {
    id: text('id').primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    externalId: text('external_id'),
    typeCode: text('type_code').notNull(),
    placeId: uuid('place_id'),
    assigneeId: uuid('assignee_id'),
    /** How a transit moves: road, or ferry between ferry_embark and ferry_disembark. */
    mode: text('mode', { enum: ['road', 'ferry'] }),
    isAuto: boolean('is_auto').notNull().default(false),
    tags: text('tags').array().notNull().default([]),
    details: jsonb('details').$type<StageDetails>().notNull().default({}),
    requirements: jsonb('requirements').$type<StageRequirement[]>().notNull().default([]),
  },
  (t) => [index('stages_trip_idx').on(t.tripId, t.seq)],
);

/**
 * The event journal. Append-only: phase and state are computed from it by
 * @plobi/core. The id is generated on the client, so offline retries are idempotent.
 */
export const tripEvents = pgTable(
  'trip_events',
  {
    id: text('id').primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    stageId: text('stage_id'),
    typeCode: text('type_code').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    authorId: uuid('author_id').notNull(),
    authorRole: text('author_role').notNull(),
    values: jsonb('values').$type<Record<string, unknown>>().notNull().default({}),
    attachments: jsonb('attachments').$type<Attachment[]>().notNull().default([]),
    forced: boolean('forced').notNull().default(false),
    /** A cancelled event stays in the journal for display and changes no phase. */
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'string' }),
    cancelledBy: uuid('cancelled_by'),
    cancelReason: text('cancel_reason'),
    acceptUnmet: boolean('accept_unmet').notNull().default(false),
    source: text('source', { enum: ['app', 'api', 'system'] }).notNull().default('app'),
  },
  (t) => [index('trip_events_trip_idx').on(t.tripId, t.occurredAt)],
);
