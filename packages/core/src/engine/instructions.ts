/**
 * Instructions: what the driver must know on a stage.
 *
 * They come from the place, from catalog rules (stage type, tags) and from the
 * stage itself. An instruction that requires "Acknowledged" turns into an
 * ordinary requirement of kind `acknowledgement`, so gating, waivers and
 * offline violations work exactly as for any other requirement.
 */
import type { Catalog, InstructionShowAt, Place } from '../catalog/types.js';
import { PHASE_RANK, type Phase } from '../machines/phase.js';
import type { StageInput, StageInstruction, StageRequirement } from './types.js';

/** Event type code that acknowledges an instruction (values: instructionId, revision). */
export const ACKNOWLEDGE_EVENT = 'instruction_acknowledged';

/** Instructions a new stage gets: place first, then catalog rules. Manual ones are added by the caller. */
export function materializeInstructions(
  stage: { readonly id: string; readonly typeCode: string; readonly tags?: readonly string[] },
  tripTags: readonly string[],
  catalog: Catalog,
  place?: Place,
): StageInstruction[] {
  const tags = new Set([...tripTags, ...(stage.tags ?? [])]);
  const fromPlace = (place?.instructions ?? []).map(
    ({ id, ...content }): StageInstruction => ({ ...content, id: `${stage.id}:place:${id}`, revision: 1, source: 'place' }),
  );
  const fromRules = catalog.instructionRules
    .filter((r) => !r.stageTypes || r.stageTypes.includes(stage.typeCode))
    .filter((r) => !r.tagsRequired || r.tagsRequired.every((t) => tags.has(t)))
    .map((r): StageInstruction => ({ ...r.instruction, id: `${stage.id}:rule:${r.code}`, revision: 1, source: 'instruction_rule' }));
  return [...fromPlace, ...fromRules];
}

const titleOf = (i: StageInstruction) =>
  typeof i.text === 'string' ? { ru: i.text } : (i.text ?? { ru: i.contact?.name ?? i.kind });

/** One `acknowledgement` requirement per instruction with ackBeforePhase. */
export function acknowledgementRequirements(instructions: readonly StageInstruction[]): StageRequirement[] {
  return instructions
    .filter((i): i is StageInstruction & { ackBeforePhase: Phase } => i.ackBeforePhase !== undefined)
    .map((i) => ({
      id: `${i.id}:ack`,
      source: 'instruction',
      title: titleOf(i),
      kind: 'acknowledgement',
      beforePhase: i.ackBeforePhase,
      instructionId: i.id,
      instructionRevision: i.revision,
      strictness: 'block',
      waivable: true,
    }));
}

/** Stage input with acknowledgement requirements derived from its instructions. */
export function withAcknowledgements(stage: StageInput): StageInput {
  const derived = acknowledgementRequirements(stage.instructions ?? []);
  if (derived.length === 0) return stage;
  const own = (stage.requirements ?? []).filter((r) => r.source !== 'instruction');
  return { ...stage, requirements: [...own, ...derived] };
}

export function isInstructionVisible(showAt: InstructionShowAt, phase: Phase | null): boolean {
  if (showAt === 'always') return true;
  return phase !== null && PHASE_RANK[phase] >= PHASE_RANK[showAt];
}
