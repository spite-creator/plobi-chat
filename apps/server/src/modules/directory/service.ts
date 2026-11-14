/**
 * Places and customers: permanent cards that stages and trips refer to.
 * Customer requirements are catalog rules scoped to the customer; they are
 * stored through the catalog module's public interface.
 */
import type { InstructionContent, InstructionRule, Place as CorePlace, RequirementRule } from '@plobi/core';
import { asc, eq, ilike } from 'drizzle-orm';
import type { Db } from '../../platform/db.js';
import { notFound } from '../../platform/errors.js';
import type { CatalogService } from '../catalog/service.js';
import { customers, places, type Contact } from './schema.js';

export type PlaceRow = typeof places.$inferSelect;
export type CustomerRow = typeof customers.$inferSelect;

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
  instructions?: Array<InstructionContent & { id: string }>;
  tags?: string[];
}

export interface CustomerInput {
  name: string;
  externalId?: string;
  contacts?: Contact[];
}

export interface CustomerRules {
  requirements: Array<Omit<RequirementRule, 'customers'>>;
  instructions: Array<Omit<InstructionRule, 'customers'>>;
}

/** A reference by our id or by the id in the client's own system. */
export type Ref = { id: string } | { externalId: string };

const customerPrefix = (id: string) => `customer:${id}:`;

export class DirectoryService {
  constructor(
    private readonly db: Db,
    private readonly catalog: CatalogService,
  ) {}

  // ---------- places ----------

  async listPlaces(query?: string): Promise<PlaceRow[]> {
    return this.db
      .select()
      .from(places)
      .where(query ? ilike(places.name, `%${query}%`) : undefined)
      .orderBy(asc(places.name));
  }

  async createPlace(input: PlaceInput): Promise<PlaceRow> {
    const [row] = await this.db.insert(places).values(input).returning();
    return row as PlaceRow;
  }

  async updatePlace(id: string, patch: Partial<PlaceInput>): Promise<PlaceRow> {
    const [row] = await this.db.update(places).set(patch).where(eq(places.id, id)).returning();
    if (!row) throw notFound('Place', id);
    return row;
  }

  async upsertPlaceByExternalId(externalId: string, input: PlaceInput): Promise<PlaceRow> {
    const values = { ...input, externalId };
    const [row] = await this.db
      .insert(places)
      .values(values)
      .onConflictDoUpdate({ target: places.externalId, set: values })
      .returning();
    return row as PlaceRow;
  }

  async findPlace(ref: Ref): Promise<PlaceRow> {
    const [row] = await this.db
      .select()
      .from(places)
      .where('id' in ref ? eq(places.id, ref.id) : eq(places.externalId, ref.externalId));
    if (!row) throw notFound('Place', 'id' in ref ? ref.id : `external ${ref.externalId}`);
    return row;
  }

  /** The place as the core engine sees it. */
  toCorePlace(row: PlaceRow): CorePlace {
    return { id: row.id, name: row.name, instructions: row.instructions as CorePlace['instructions'] };
  }

  // ---------- customers ----------

  async listCustomers(query?: string): Promise<CustomerRow[]> {
    return this.db
      .select()
      .from(customers)
      .where(query ? ilike(customers.name, `%${query}%`) : undefined)
      .orderBy(asc(customers.name));
  }

  async createCustomer(input: CustomerInput): Promise<CustomerRow> {
    const [row] = await this.db.insert(customers).values(input).returning();
    return row as CustomerRow;
  }

  async upsertCustomerByExternalId(externalId: string, input: CustomerInput): Promise<CustomerRow> {
    const values = { ...input, externalId };
    const [row] = await this.db
      .insert(customers)
      .values(values)
      .onConflictDoUpdate({ target: customers.externalId, set: values })
      .returning();
    return row as CustomerRow;
  }

  async findCustomer(ref: Ref): Promise<CustomerRow> {
    const [row] = await this.db
      .select()
      .from(customers)
      .where('id' in ref ? eq(customers.id, ref.id) : eq(customers.externalId, ref.externalId));
    if (!row) throw notFound('Customer', 'id' in ref ? ref.id : `external ${ref.externalId}`);
    return row;
  }

  /** Customer requirements: rules with condition "customer = this one". */
  async customerRules(id: string): Promise<CustomerRules> {
    await this.findCustomer({ id });
    const rules = await this.catalog.ownedRules(customerPrefix(id));
    const strip = <T extends { customers?: readonly string[] }>({ customers: _, ...rest }: T) => rest;
    return { requirements: rules.requirements.map(strip), instructions: rules.instructions.map(strip) };
  }

  async setCustomerRules(id: string, rules: CustomerRules) {
    await this.findCustomer({ id });
    return this.catalog.replaceOwnedRules(customerPrefix(id), {
      requirements: rules.requirements.map((r) => ({ ...r, customers: [id] })),
      instructions: rules.instructions.map((r) => ({ ...r, customers: [id] })),
    });
  }
}
