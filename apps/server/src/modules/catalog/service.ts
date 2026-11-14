/**
 * The company catalog, stored as JSON documents and assembled into a core `Catalog`.
 *
 * System entries from BASE_CATALOG are inserted once and never overwritten,
 * so a company's edits survive product updates.
 */
import {
  BASE_CATALOG,
  validateCatalog,
  type Catalog,
  type CatalogIssue,
  type InstructionRule,
  type RequirementRule,
} from '@plobi/core';
import { and, eq, like } from 'drizzle-orm';
import type { Db, Tx } from '../../platform/db.js';
import { badRequest, notFound } from '../../platform/errors.js';
import type { EventBus } from '../../platform/event-bus.js';
import { catalogItems, type CatalogKind } from './schema.js';

type Row = typeof catalogItems.$inferSelect;
type NewRow = typeof catalogItems.$inferInsert;

export interface CatalogItemView {
  kind: CatalogKind;
  code: string;
  data: unknown;
  isSystem: boolean;
  hidden: boolean;
}

const KEYED: Record<Exclude<CatalogKind, 'requirement_rule' | 'instruction_rule'>, keyof Catalog> = {
  stage_type: 'stageTypes',
  event_type: 'eventTypes',
  incident_type: 'incidentTypes',
  requirement_template: 'requirementTemplates',
};

function baseRows(): NewRow[] {
  const keyed = (kind: keyof typeof KEYED) =>
    Object.values(BASE_CATALOG[KEYED[kind]] as Record<string, { code: string }>).map((data) => ({
      kind,
      code: data.code,
      data,
      isSystem: true,
    }));
  return [
    ...keyed('stage_type'),
    ...keyed('event_type'),
    ...keyed('incident_type'),
    ...keyed('requirement_template'),
    ...BASE_CATALOG.requirementRules.map((data, i) => ({
      kind: 'requirement_rule' as const,
      code: `base:${i}:${data.template}`,
      data,
      isSystem: true,
    })),
    ...BASE_CATALOG.instructionRules.map((data) => ({
      kind: 'instruction_rule' as const,
      code: `base:${data.code}`,
      data,
      isSystem: true,
    })),
  ];
}

/** Builds a core Catalog from stored rows (hidden ones excluded). */
export function assembleCatalog(rows: readonly Pick<Row, 'kind' | 'code' | 'data' | 'hidden'>[]): Catalog {
  const catalog = {
    stageTypes: {},
    eventTypes: {},
    incidentTypes: {},
    requirementTemplates: {},
    requirementRules: [] as RequirementRule[],
    instructionRules: [] as InstructionRule[],
  } as { -readonly [K in keyof Catalog]: Catalog[K] };
  for (const row of rows) {
    if (row.hidden) continue;
    if (row.kind === 'requirement_rule') catalog.requirementRules = [...catalog.requirementRules, row.data as RequirementRule];
    else if (row.kind === 'instruction_rule') catalog.instructionRules = [...catalog.instructionRules, row.data as InstructionRule];
    else (catalog[KEYED[row.kind]] as Record<string, unknown>)[row.code] = row.data;
  }
  return catalog;
}

export class CatalogService {
  private cached: Catalog | undefined;

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
  ) {}

  async seedSystemEntries(): Promise<void> {
    await this.db.insert(catalogItems).values(baseRows()).onConflictDoNothing();
    this.cached = undefined;
  }

  async get(): Promise<Catalog> {
    this.cached ??= assembleCatalog(await this.db.select().from(catalogItems));
    return this.cached;
  }

  async listItems(kind?: CatalogKind): Promise<CatalogItemView[]> {
    const rows = await this.db.select().from(catalogItems).where(kind ? eq(catalogItems.kind, kind) : undefined);
    return rows.map(({ kind: k, code, data, isSystem, hidden }) => ({ kind: k, code, data, isSystem, hidden }));
  }

  async issues(): Promise<CatalogIssue[]> {
    return validateCatalog(await this.get());
  }

  /** Creates or replaces an entry. Rejected if the resulting catalog has errors. */
  async upsertItem(kind: CatalogKind, code: string, data: Record<string, unknown>): Promise<CatalogIssue[]> {
    const document = kind in KEYED ? { ...data, code } : data;
    return this.change(async (tx) => {
      await tx
        .insert(catalogItems)
        .values({ kind, code, data: document })
        .onConflictDoUpdate({ target: [catalogItems.kind, catalogItems.code], set: { data: document, updatedAt: new Date() } });
    });
  }

  /** Hides an entry (system entries cannot be deleted, so integrations do not break). */
  async setHidden(kind: CatalogKind, code: string, hidden: boolean): Promise<CatalogIssue[]> {
    return this.change(async (tx) => {
      const updated = await tx
        .update(catalogItems)
        .set({ hidden, updatedAt: new Date() })
        .where(and(eq(catalogItems.kind, kind), eq(catalogItems.code, code)))
        .returning({ code: catalogItems.code });
      if (updated.length === 0) throw notFound('Catalog item', `${kind}/${code}`);
    });
  }

  /**
   * Replaces all rules owned by one card (customer or place), identified by a
   * code prefix, e.g. "customer:<id>:".
   */
  async replaceOwnedRules(
    prefix: string,
    rules: { requirements: RequirementRule[]; instructions: InstructionRule[] },
  ): Promise<CatalogIssue[]> {
    return this.change(async (tx) => {
      await tx.delete(catalogItems).where(like(catalogItems.code, `${prefix}%`));
      const rows: NewRow[] = [
        ...rules.requirements.map((data, i) => ({ kind: 'requirement_rule' as const, code: `${prefix}${i}:${data.template}`, data })),
        ...rules.instructions.map((data) => ({ kind: 'instruction_rule' as const, code: `${prefix}${data.code}`, data })),
      ];
      if (rows.length > 0) await tx.insert(catalogItems).values(rows);
    });
  }

  async ownedRules(prefix: string): Promise<{ requirements: RequirementRule[]; instructions: InstructionRule[] }> {
    const rows = await this.db.select().from(catalogItems).where(like(catalogItems.code, `${prefix}%`));
    return {
      requirements: rows.filter((r) => r.kind === 'requirement_rule').map((r) => r.data as RequirementRule),
      instructions: rows.filter((r) => r.kind === 'instruction_rule').map((r) => r.data as InstructionRule),
    };
  }

  /** Applies a change in a transaction and keeps it only if the catalog stays valid. */
  private async change(apply: (tx: Tx) => Promise<void>): Promise<CatalogIssue[]> {
    const issues = await this.db.transaction(async (tx) => {
      await apply(tx);
      const result = validateCatalog(assembleCatalog(await tx.select().from(catalogItems)));
      const errors = result.filter((i) => i.severity === 'error');
      if (errors.length > 0) throw badRequest('catalog_invalid', 'The change would break the catalog', errors);
      return result;
    });
    this.cached = undefined;
    await this.bus.publish('catalog.changed', {});
    return issues;
  }
}
