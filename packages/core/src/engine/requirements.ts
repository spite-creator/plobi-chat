/**
 * Requirements: one list per stage of what the driver sees and does.
 *
 * Each requirement kind has a measure. New kinds are added to MEASURES;
 * nothing else changes. `info` is only shown; every other kind can gate a
 * phase (beforePhase).
 */
import type { Catalog, RequirementKind, ShowAt } from '../catalog/types.js';
import { PHASE_RANK, type Phase } from '../machines/phase.js';
import { isEmptyValue } from './fields.js';
import { phaseTime, type AppliedEvent, type RequirementRun, type StageRun } from './run.js';
import type { StageRequirement } from './types.js';

/** Event type code that acknowledges a requirement (values: requirementId, revision). */
export const ACKNOWLEDGE_EVENT = 'acknowledged';

export interface Measurement {
  readonly have: number;
  readonly need: number;
}

type Measure = (req: StageRequirement, events: readonly AppliedEvent[], windowStart: number) => number;

const countAttachments =
  (kind: 'photo' | 'video' | 'document' | 'signature'): Measure =>
  (req, events, windowStart) =>
    events
      .flatMap((e) => (e.input.attachments ?? []).map((a) => ({ a, at: e.at })))
      .filter(({ a, at }) => {
        const capturedAt = a.capturedAt ? Date.parse(a.capturedAt) : at;
        return (
          a.requirementId === req.id &&
          a.kind === kind &&
          (!req.cameraOnly || a.source === 'camera') &&
          capturedAt >= windowStart
        );
      }).length;

const countValues: Measure = (req, events, windowStart) =>
  events.filter((e) => e.at >= windowStart && req.valueKey && !isEmptyValue(e.input.values?.[req.valueKey])).length;

const countEvents: Measure = (req, events, windowStart) =>
  events.filter((e) => e.at >= windowStart && e.input.typeCode === req.eventType).length;

/** Only an acknowledgement of the current revision counts. */
const countAcknowledgements: Measure = (req, events) =>
  events.filter(
    (e) =>
      e.input.typeCode === ACKNOWLEDGE_EVENT &&
      e.input.values?.['requirementId'] === req.id &&
      e.input.values?.['revision'] === (req.revision ?? 1),
  ).length;

/** Information has nothing to collect: it is fulfilled by being shown. */
const nothingToCollect: Measure = () => 0;

const MEASURES: Readonly<Record<RequirementKind, Measure>> = {
  info: nothingToCollect,
  acknowledgement: countAcknowledgements,
  photo: countAttachments('photo'),
  video: countAttachments('video'),
  document: countAttachments('document'),
  signature: countAttachments('signature'),
  scan: countValues,
  number: countValues,
  text: countValues,
  checklist: countValues,
  event: countEvents,
};

/** Start of the capture window, or +Infinity if its phase was not reached yet. */
function windowStart(stage: StageRun, req: StageRequirement): number {
  if (!req.captureFromPhase) return Number.NEGATIVE_INFINITY;
  return phaseTime(stage, req.captureFromPhase) ?? Number.POSITIVE_INFINITY;
}

export function measure(stage: StageRun, req: StageRequirement, extra?: AppliedEvent): Measurement {
  const events = extra ? [...stage.events, extra] : stage.events;
  if (req.kind === 'info') return { have: 0, need: 0 };
  return { have: MEASURES[req.kind](req, events, windowStart(stage, req)), need: req.min ?? 1 };
}

export function isFulfilled(m: Measurement): boolean {
  return m.have >= m.need;
}

export const strictnessOf = (req: StageRequirement) => req.strictness ?? 'block';
export const isWaivable = (req: StageRequirement) => req.waivable ?? true;

export function isVisible(showAt: ShowAt | undefined, phase: Phase | null): boolean {
  if (!showAt || showAt === 'always') return true;
  return phase !== null && PHASE_RANK[phase] >= PHASE_RANK[showAt];
}

export interface GateResult {
  /** Requirements this transition checks. */
  readonly checked: readonly RequirementRun[];
  /** Unmet requirements with strictness = block. */
  readonly blocking: readonly RequirementRun[];
  /** Unmet requirements with strictness = warn. */
  readonly warnings: readonly RequirementRun[];
}

/**
 * Requirements gated by entering `target`: every not-yet-gated requirement whose
 * beforePhase is at or before the target. Evidence attached to the transition
 * event itself counts (photos taken from the checklist).
 */
export function gate(stage: StageRun, target: Phase, candidate: AppliedEvent): GateResult {
  const checked = stage.requirements.filter(
    (r) =>
      !r.gated && !r.waived && r.spec.beforePhase !== undefined && PHASE_RANK[target] >= PHASE_RANK[r.spec.beforePhase],
  );
  const unmet = checked.filter((r) => !isFulfilled(measure(stage, r.spec, candidate)));
  return {
    checked,
    blocking: unmet.filter((r) => strictnessOf(r.spec) === 'block'),
    warnings: unmet.filter((r) => strictnessOf(r.spec) === 'warn'),
  };
}

export const NOTHING_GATED: GateResult = { checked: [], blocking: [], warnings: [] };

export function markGated(result: GateResult): void {
  for (const r of result.checked) r.gated = true;
  for (const r of [...result.blocking, ...result.warnings]) r.violated = true;
}

/** The stage was left without the work being done: pending requirements no longer apply. */
export function markNotApplicable(stage: StageRun): void {
  for (const r of stage.requirements) {
    if (!r.gated && !r.waived && r.spec.beforePhase !== undefined) {
      r.gated = true;
      r.notApplicable = true;
    }
  }
}

/**
 * Default requirements a new stage gets from the catalog: by its stage type,
 * optionally only with certain tags. Called once when a trip is created;
 * afterwards they live on the stage next to the ones added for this trip.
 */
export function materializeRequirements(
  stage: { readonly id: string; readonly typeCode: string; readonly tags?: readonly string[] },
  trip: { readonly tags?: readonly string[] },
  catalog: Catalog,
): StageRequirement[] {
  const tags = new Set([...(trip.tags ?? []), ...(stage.tags ?? [])]);
  const result = new Map<string, StageRequirement>(); // one per template, even if several rules match
  for (const rule of catalog.requirementRules) {
    if (rule.stageTypes && !rule.stageTypes.includes(stage.typeCode)) continue;
    if (rule.tagsRequired && !rule.tagsRequired.every((t) => tags.has(t))) continue;
    const template = catalog.requirementTemplates[rule.template];
    if (!template || result.has(template.code)) continue;
    const { code, ...spec } = template;
    result.set(code, {
      ...spec,
      id: `${stage.id}:${code}`,
      template: code,
      source: rule.tagsRequired ? 'tag_rule' : 'stage_type',
    });
  }
  return [...result.values()];
}
