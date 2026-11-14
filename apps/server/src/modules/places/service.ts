/**
 * Places: warehouses, customs posts, ports. A stage refers to a place, so the
 * address, coordinates, time zone and contacts are entered once.
 */
import { asc, eq, ilike } from 'drizzle-orm';
import type { Db } from '../../platform/db.js';
import { notFound } from '../../platform/errors.js';
import { places, type Contact } from './schema.js';

export type PlaceRow = typeof places.$inferSelect;

export interface PlaceInput {
  name: string;
  externalId?: string;
  kind?: string;
  address?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  workingHours?: string;
  contacts?: Contact[];
  tags?: string[];
}

/** A reference by our id or by the id in the client's own system. */
export type Ref = { id: string } | { externalId: string };

export class PlaceService {
  constructor(private readonly db: Db) {}

  async list(query?: string): Promise<PlaceRow[]> {
    return this.db
      .select()
      .from(places)
      .where(query ? ilike(places.name, `%${query}%`) : undefined)
      .orderBy(asc(places.name));
  }

  async create(input: PlaceInput): Promise<PlaceRow> {
    const [row] = await this.db.insert(places).values(input).returning();
    return row as PlaceRow;
  }

  async update(id: string, patch: Partial<PlaceInput>): Promise<PlaceRow> {
    const [row] = await this.db.update(places).set(patch).where(eq(places.id, id)).returning();
    if (!row) throw notFound('Place', id);
    return row;
  }

  async upsertByExternalId(externalId: string, input: PlaceInput): Promise<PlaceRow> {
    const values = { ...input, externalId };
    const [row] = await this.db
      .insert(places)
      .values(values)
      .onConflictDoUpdate({ target: places.externalId, set: values })
      .returning();
    return row as PlaceRow;
  }

  async find(ref: Ref): Promise<PlaceRow> {
    const [row] = await this.db
      .select()
      .from(places)
      .where('id' in ref ? eq(places.id, ref.id) : eq(places.externalId, ref.externalId));
    if (!row) throw notFound('Place', 'id' in ref ? ref.id : `external ${ref.externalId}`);
    return row;
  }
}
