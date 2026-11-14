/**
 * Trips: creation, the event journal and computed state.
 *
 * The journal is the source of truth. Phase and state are computed by
 * @plobi/core on read; nothing about them is stored, so a late offline event
 * simply takes its place in time and everything is recomputed.
 */
import {
  availableEvents,
  evaluateTrip,
  type RequirementStatus,
  type StageRequirement,
  type Attachment,
  type EventInput,
  type EventResult,
  type StageResult,
  type TripInput,
  type TripResult,
} from '@plobi/core';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db, Tx } from '../../platform/db.js';
import { conflict, notFound } from '../../platform/errors.js';
import type { EventBus } from '../../platform/event-bus.js';
import type { CatalogService } from '../catalog/service.js';
import type { PlaceService, Ref } from '../places/service.js';
import type { AuthUser, IdentityService } from '../identity/service.js';
import { assertCanSee, assertCanSubmit, canSeeTrip, engineRole } from './access.js';
import { assembleStages, type IncomingStage } from './assemble.js';
import { stages, tripEvents, trips } from './schema.js';

type TripRow = typeof trips.$inferSelect;
type StageRow = typeof stages.$inferSelect;
type EventRow = typeof tripEvents.$inferSelect;

export interface CreateTripInput {
  externalId?: string;
  number: string;
  driver?: Ref;
  tags?: string[];
  vehicle?: Record<string, unknown>;
  cargo?: Record<string, unknown>;
  customFields?: Record<string, unknown>;
  stages: Array<Omit<IncomingStage, 'placeId'> & { place?: Ref }>;
}

export interface SubmittedEvent {
  id: string;
  typeCode: string;
  stageId?: string;
  occurredAt: string;
  values?: Record<string, unknown>;
  attachments?: Attachment[];
  forced?: boolean;
  acceptUnmet?: boolean;
}

/** A stage as the apps see it: stored description plus computed state. */
export interface StageView extends Omit<StageResult, 'requirements'> {
  seq: number;
  externalId: string | null;
  placeId: string | null;
  assigneeId: string | null;
  isAuto: boolean;
  tags: string[];
  details: StageRow['details'];
  /** What the driver sees and does (spec) and how far it is (status). */
  requirements: Array<StageRequirement & RequirementStatus>;
}

function stageView(row: StageRow, result: StageResult): StageView {
  const specs = new Map(row.requirements.map((r) => [r.id, r] as const));
  return {
    ...result,
    seq: row.seq,
    externalId: row.externalId,
    placeId: row.placeId,
    assigneeId: row.assigneeId,
    isAuto: row.isAuto,
    tags: row.tags,
    details: row.details,
    requirements: result.requirements.map((status) => ({ ...(specs.get(status.id) as StageRequirement), ...status })),
  };
}

export interface TripView {
  id: string;
  externalId: string | null;
  number: string;
  driverId: string | null;
  tags: string[];
  vehicle: Record<string, unknown>;
  cargo: Record<string, unknown>;
  state: TripResult['state'];
  currentStageId?: string;
  stages: StageView[];
  incidents: TripResult['incidents'];
}

export interface JournalEntry extends EventInput {
  result: EventResult;
}

interface Loaded {
  trip: TripRow;
  stages: StageRow[];
  events: EventRow[];
}

const toTripInput = ({ trip, stages: rows }: Pick<Loaded, 'trip' | 'stages'>): TripInput => ({
  id: trip.id,
  ...(trip.driverId ? { driverId: trip.driverId } : {}),
  tags: trip.tags,
  stages: rows.map((s) => ({
    id: s.id,
    typeCode: s.typeCode,
    isAuto: s.isAuto,
    tags: s.tags,
    requirements: s.requirements,
    ...(s.assigneeId ? { assigneeId: s.assigneeId } : {}),
  })),
});

const toEventInput = (e: EventRow): EventInput => ({
  id: e.id,
  typeCode: e.typeCode,
  ...(e.stageId ? { stageId: e.stageId } : {}),
  occurredAt: new Date(e.occurredAt).toISOString(),
  receivedAt: new Date(e.receivedAt).toISOString(),
  authorId: e.authorId,
  authorRole: e.authorRole as EventInput['authorRole'],
  values: e.values,
  attachments: e.attachments,
  forced: e.forced,
  acceptUnmet: e.acceptUnmet,
});

const participants = (l: Pick<Loaded, 'trip' | 'stages'>) => ({
  driverId: l.trip.driverId,
  assigneeIds: l.stages.map((s) => s.assigneeId),
});

export class TripService {
  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly catalog: CatalogService,
    private readonly places: PlaceService,
    private readonly identity: IdentityService,
  ) {}

  // ---------- creation ----------

  async createTrip(input: CreateTripInput): Promise<TripView> {
    const catalog = await this.catalog.get();
    const driverId = input.driver ? (await this.identity.findUser(input.driver)).id : undefined;

    const incoming: IncomingStage[] = [];
    for (const { place, ...stage } of input.stages) {
      // The place gives address, coordinates and time zone; the stage may override them.
      const row = place ? await this.places.find(place) : undefined;
      incoming.push({
        ...stage,
        ...(row ? { placeId: row.id } : {}),
        details: {
          ...(row?.address ? { address: row.address } : {}),
          ...(row?.lat != null && row.lon != null ? { lat: row.lat, lon: row.lon } : {}),
          ...(row?.timezone ? { timezone: row.timezone } : {}),
          ...stage.details,
        },
      });
    }
    const records = assembleStages(incoming, { catalog, tripTags: input.tags ?? [] });

    const tripId = await this.db.transaction(async (tx) => {
      if (input.externalId) {
        const [taken] = await tx.select({ id: trips.id }).from(trips).where(eq(trips.externalId, input.externalId));
        if (taken) throw conflict('external_id_taken', `Trip ${input.externalId} already exists`, { id: taken.id });
      }
      const [trip] = await tx
        .insert(trips)
        .values({
          number: input.number,
          externalId: input.externalId ?? null,
          driverId: driverId ?? null,
          tags: input.tags ?? [],
          vehicle: input.vehicle ?? {},
          cargo: input.cargo ?? {},
          customFields: input.customFields ?? {},
        })
        .returning({ id: trips.id });
      const id = (trip as { id: string }).id;
      await tx.insert(stages).values(
        records.map((r) => ({
          id: r.id,
          tripId: id,
          seq: r.seq,
          externalId: r.externalId ?? null,
          typeCode: r.typeCode,
          placeId: r.placeId ?? null,
          assigneeId: r.assigneeId ?? null,
          isAuto: r.isAuto ?? false,
          tags: [...(r.tags ?? [])],
          details: r.details,
          requirements: r.requirements,
        })),
      );
      return id;
    });

    await this.bus.publish('trip.created', { tripId });
    return this.view(await this.load(this.db, tripId), catalog);
  }

  // ---------- reading ----------

  async getTrip(id: string, user: AuthUser): Promise<TripView & { journal: JournalEntry[] }> {
    const loaded = await this.load(this.db, id);
    assertCanSee(user, participants(loaded));
    const catalog = await this.catalog.get();
    const result = this.evaluate(loaded, catalog);
    const byId = new Map(result.events.map((r) => [r.eventId, r]));
    const journal = loaded.events.map(toEventInput).map((e) => ({ ...e, result: byId.get(e.id) as EventResult }));
    return { ...this.view(loaded, catalog, result), journal };
  }

  async listTrips(user: AuthUser, filter: { state?: TripResult['state'] } = {}): Promise<TripView[]> {
    const catalog = await this.catalog.get();
    const rows = await this.db.select().from(trips).orderBy(desc(trips.createdAt)).limit(200);
    if (rows.length === 0) return [];
    const ids = rows.map((t) => t.id);
    const allStages = await this.db.select().from(stages).where(inArray(stages.tripId, ids)).orderBy(asc(stages.seq));
    const allEvents = await this.db.select().from(tripEvents).where(inArray(tripEvents.tripId, ids));

    return rows
      .map((trip) => ({
        trip,
        stages: allStages.filter((s) => s.tripId === trip.id),
        events: allEvents.filter((e) => e.tripId === trip.id),
      }))
      .filter((l) => canSeeTrip(user, participants(l)))
      .map((l) => this.view(l, catalog))
      .filter((v) => !filter.state || v.state === filter.state);
  }

  async available(tripId: string, user: AuthUser, query: { stageId?: string; forced?: boolean }) {
    const loaded = await this.load(this.db, tripId);
    assertCanSee(user, participants(loaded));
    return availableEvents(toTripInput(loaded), loaded.events.map(toEventInput), await this.catalog.get(), {
      role: engineRole(user),
      userId: user.id,
      at: new Date().toISOString(),
      ...(query.stageId ? { stageId: query.stageId } : {}),
      ...(query.forced ? { forced: true } : {}),
    });
  }

  // ---------- the journal ----------

  /**
   * Online submission: the event must fit the journal now, and must not turn
   * any already accepted event into a conflict. Otherwise 409, nothing stored.
   * Repeating the same event id is idempotent.
   */
  async submitEvent(tripId: string, submitted: SubmittedEvent, user: AuthUser): Promise<{ result: EventResult; trip: TripView }> {
    const catalog = await this.catalog.get();
    const outcome = await this.db.transaction(async (tx) => {
      const loaded = await this.load(tx, tripId, { lock: true });
      assertCanSubmit(user, participants(loaded));

      const before = this.evaluate(loaded, catalog);
      const repeated = before.events.find((r) => r.eventId === submitted.id);
      if (repeated) return { loaded, result: before, eventId: submitted.id };
      await this.assertIdFree(tx, submitted.id);

      const candidate = this.newEventRow(tripId, submitted, user);
      const after = this.evaluate({ ...loaded, events: [...loaded.events, candidate] }, catalog);
      const result = after.events.find((r) => r.eventId === submitted.id) as EventResult;
      if (result.result === 'conflict') {
        throw conflict('event_rejected', `Event ${submitted.typeCode} does not fit the trip now`, result.conflict);
      }
      const conflictedBefore = new Set(before.events.filter((r) => r.result === 'conflict').map((r) => r.eventId));
      const broken = after.events.filter((r) => r.result === 'conflict' && !conflictedBefore.has(r.eventId));
      if (broken.length > 0) {
        throw conflict('event_breaks_journal', 'The event would invalidate events already accepted', broken);
      }

      await tx.insert(tripEvents).values(candidate);
      return { loaded: { ...loaded, events: [...loaded.events, candidate] }, result: after, eventId: submitted.id };
    });

    await this.bus.publish('trip.events_applied', { tripId, eventIds: [submitted.id] });
    return {
      result: outcome.result.events.find((r) => r.eventId === outcome.eventId) as EventResult,
      trip: this.view(outcome.loaded, catalog, outcome.result),
    };
  }

  /**
   * Offline sync: every event is stored, even if it no longer fits; such events
   * are kept as conflicts for the dispatcher. Nothing a driver recorded is lost.
   */
  async submitBatch(events: Array<SubmittedEvent & { tripId: string }>, user: AuthUser): Promise<EventResult[]> {
    const catalog = await this.catalog.get();
    const byTrip = new Map<string, SubmittedEvent[]>();
    for (const { tripId, ...e } of events) byTrip.set(tripId, [...(byTrip.get(tripId) ?? []), e]);

    const results: EventResult[] = [];
    for (const [tripId, list] of byTrip) {
      const applied = await this.db.transaction(async (tx) => {
        const loaded = await this.load(tx, tripId, { lock: true });
        assertCanSubmit(user, participants(loaded));
        const known = new Set(loaded.events.map((e) => e.id));
        const fresh = list.filter((e) => !known.has(e.id)).map((e) => this.newEventRow(tripId, e, user));
        if (fresh.length > 0) await tx.insert(tripEvents).values(fresh).onConflictDoNothing();
        const after = this.evaluate({ ...loaded, events: [...loaded.events, ...fresh] }, catalog);
        const wanted = new Set(list.map((e) => e.id));
        return { results: after.events.filter((r) => wanted.has(r.eventId)), freshIds: fresh.map((e) => e.id) };
      });
      results.push(...applied.results);
      if (applied.freshIds.length > 0) await this.bus.publish('trip.events_applied', { tripId, eventIds: applied.freshIds });
    }
    return results;
  }

  // ---------- internals ----------

  private newEventRow(tripId: string, e: SubmittedEvent, user: AuthUser): EventRow {
    return {
      id: e.id,
      tripId,
      stageId: e.stageId ?? null,
      typeCode: e.typeCode,
      occurredAt: e.occurredAt,
      receivedAt: new Date().toISOString(),
      // The author is always the signed-in user, never taken from the request body.
      authorId: user.id,
      authorRole: engineRole(user),
      values: e.values ?? {},
      attachments: e.attachments ?? [],
      forced: e.forced ?? false,
      acceptUnmet: e.acceptUnmet ?? false,
      source: 'app',
    };
  }

  private async assertIdFree(tx: Tx, id: string): Promise<void> {
    const [taken] = await tx.select({ id: tripEvents.id }).from(tripEvents).where(eq(tripEvents.id, id));
    if (taken) throw conflict('event_id_taken', `Event id ${id} is used by another trip`);
  }

  private async load(db: Db | Tx, tripId: string, options: { lock?: boolean } = {}): Promise<Loaded> {
    const query = db.select().from(trips).where(eq(trips.id, tripId));
    // Row lock serializes concurrent submissions to the same trip.
    const [trip] = options.lock ? await query.for('update') : await query;
    if (!trip) throw notFound('Trip', tripId);
    const stageRows = await db.select().from(stages).where(eq(stages.tripId, tripId)).orderBy(asc(stages.seq));
    const eventRows = await db.select().from(tripEvents).where(eq(tripEvents.tripId, tripId));
    return { trip, stages: stageRows, events: eventRows };
  }

  private evaluate(loaded: Loaded, catalog: Awaited<ReturnType<CatalogService['get']>>): TripResult {
    return evaluateTrip(toTripInput(loaded), loaded.events.map(toEventInput), catalog);
  }

  private view(loaded: Loaded, catalog: Awaited<ReturnType<CatalogService['get']>>, result = this.evaluate(loaded, catalog)): TripView {
    const { trip } = loaded;
    return {
      id: trip.id,
      externalId: trip.externalId,
      number: trip.number,
      driverId: trip.driverId,
      tags: trip.tags,
      vehicle: trip.vehicle,
      cargo: trip.cargo,
      state: result.state,
      ...(result.currentStageId ? { currentStageId: result.currentStageId } : {}),
      stages: loaded.stages.map((row, i) => stageView(row, result.stages[i] as StageResult)),
      incidents: result.incidents,
    };
  }
}
