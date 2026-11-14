/**
 * Turning an incoming trip (points from an integration or the UI) into stored
 * stages: transits inserted, requirements and instructions materialized from
 * the catalog, the place and the customer.
 */
import { randomUUID } from 'node:crypto';
import {
  insertTransits,
  materializeInstructions,
  materializeRequirements,
  type Catalog,
  type InstructionContent,
  type Place,
  type RequirementSpec,
  type StageInput,
  type StageInstruction,
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
  /** One-off requirements for this stage (from the order or the dispatcher). */
  requirements?: RequirementSpec[];
  /** One-off instructions for this stage. */
  instructions?: InstructionContent[];
}

export interface StageRecord extends StageInput {
  readonly seq: number;
  readonly externalId?: string;
  readonly placeId?: string;
  readonly assigneeId?: string;
  readonly details: StageDetails;
  readonly requirements: StageRequirement[];
  readonly instructions: StageInstruction[];
}

export interface AssembleContext {
  readonly catalog: Catalog;
  readonly tripTags: readonly string[];
  readonly customerId?: string;
  /** Places referenced by stages, by id. */
  readonly places: ReadonlyMap<string, Place>;
}

export function assembleStages(incoming: readonly IncomingStage[], ctx: AssembleContext): StageRecord[] {
  if (incoming.length === 0) throw badRequest('stages_required', 'A trip needs at least one stage');

  const byId = new Map<string, IncomingStage>();
  const inputs: StageInput[] = incoming.map((s) => {
    if (!ctx.catalog.stageTypes[s.type]) throw badRequest('unknown_stage_type', `Unknown stage type ${s.type}`);
    const id = randomUUID();
    byId.set(id, s);
    return { id, typeCode: s.type, ...(s.tags ? { tags: s.tags } : {}), ...(s.placeId ? { placeId: s.placeId } : {}) };
  });

  return insertTransits(inputs, ctx.catalog).map((stage, seq): StageRecord => {
    const source = byId.get(stage.id);
    if (!source) return { ...stage, seq, details: {}, requirements: [], instructions: [] }; // automatic transit

    const facts = { id: stage.id, typeCode: stage.typeCode, tags: source.tags, placeId: source.placeId };
    const trip = { tags: ctx.tripTags, customerId: ctx.customerId };
    const place = source.placeId ? ctx.places.get(source.placeId) : undefined;

    const manualRequirements = (source.requirements ?? []).map(
      (spec, i): StageRequirement => ({ ...spec, id: `${stage.id}:manual:${i}`, source: 'manual' }),
    );
    const manualInstructions = (source.instructions ?? []).map(
      (content, i): StageInstruction => ({ ...content, id: `${stage.id}:manual:${i}`, revision: 1, source: 'manual' }),
    );

    return {
      ...stage,
      seq,
      ...(source.externalId ? { externalId: source.externalId } : {}),
      ...(source.assigneeId ? { assigneeId: source.assigneeId } : {}),
      details: source.details ?? {},
      requirements: [...materializeRequirements(facts, trip, ctx.catalog), ...manualRequirements],
      instructions: [...materializeInstructions(facts, trip, ctx.catalog, place), ...manualInstructions],
    };
  });
}
