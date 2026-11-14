/**
 * Turning an incoming trip (points from an integration or the UI) into stored
 * stages: transits inserted, and every point gets one list of requirements —
 * the defaults of its stage type plus the ones sent with the stage.
 */
import { randomUUID } from 'node:crypto';
import {
  insertTransits,
  materializeRequirements,
  REQUIREMENT_KINDS,
  type Catalog,
  type RequirementSpec,
  type StageInput,
  type StageRequirement,
} from '@plobi/core';
import { badRequest } from '../../platform/errors.js';
import type { StageDetails } from './schema.js';

export interface IncomingStage {
  externalId?: string;
  type: string;
  placeId?: string;
  assigneeId?: string;
  tags?: string[];
  details?: StageDetails;
  /** What the driver must see and do on this stage: info, "Acknowledged", photos, documents... */
  requirements?: RequirementSpec[];
}

export interface StageRecord extends StageInput {
  readonly seq: number;
  readonly externalId?: string;
  readonly placeId?: string;
  readonly assigneeId?: string;
  readonly details: StageDetails;
  readonly requirements: StageRequirement[];
}

function checkRequirement(spec: RequirementSpec, where: string): void {
  if (!REQUIREMENT_KINDS.includes(spec.kind)) {
    throw badRequest('invalid_requirement', `${where}: unknown kind ${String(spec.kind)}`);
  }
  if (!spec.title) throw badRequest('invalid_requirement', `${where}: title is required`);
  if (spec.kind !== 'info' && !spec.beforePhase) {
    throw badRequest('invalid_requirement', `${where}: beforePhase is required for kind ${spec.kind}`);
  }
}

export function assembleStages(
  incoming: readonly IncomingStage[],
  ctx: { readonly catalog: Catalog; readonly tripTags: readonly string[] },
): StageRecord[] {
  if (incoming.length === 0) throw badRequest('stages_required', 'A trip needs at least one stage');

  const byId = new Map<string, IncomingStage>();
  const inputs: StageInput[] = incoming.map((s, i) => {
    if (!ctx.catalog.stageTypes[s.type]) throw badRequest('unknown_stage_type', `Unknown stage type ${s.type}`);
    s.requirements?.forEach((r, k) => checkRequirement(r, `stages[${i}].requirements[${k}]`));
    const id = randomUUID();
    byId.set(id, s);
    return { id, typeCode: s.type, ...(s.tags ? { tags: s.tags } : {}) };
  });

  return insertTransits(inputs, ctx.catalog).map((stage, seq): StageRecord => {
    const source = byId.get(stage.id);
    if (!source) return { ...stage, seq, details: {}, requirements: [] }; // automatic transit

    const defaults = materializeRequirements(stage, { tags: ctx.tripTags }, ctx.catalog);
    const own = (source.requirements ?? []).map(
      (spec, i): StageRequirement => ({ ...spec, id: `${stage.id}:r${i}`, source: 'manual' }),
    );
    return {
      ...stage,
      seq,
      ...(source.externalId ? { externalId: source.externalId } : {}),
      ...(source.placeId ? { placeId: source.placeId } : {}),
      ...(source.assigneeId ? { assigneeId: source.assigneeId } : {}),
      details: source.details ?? {},
      requirements: [...defaults, ...own],
    };
  });
}
