/**
 * Requirements: measuring collected evidence and gating phase transitions.
 *
 * Each requirement kind has a measure. New kinds are added to MEASURES;
 * nothing else changes.
 */
import { ruleApplies, ruleOrigin, ruleSubject, type StageFacts, type TripFacts } from '../catalog/rule-scope.js';
import type { Catalog, RequirementKind } from '../catalog/types.js';
import { PHASE_RANK, type Phase } from '../machines/phase.js';
import { isEmptyValue } from './fields.js';
import { ACKNOWLEDGE_EVENT } from './instructions.js';
import { phaseTime, type AppliedEvent, type RequirementRun, type StageRun } from './run.js';
import type { StageRequirement } from './types.js';

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
      e.input.values?.['instructionId'] === req.instructionId &&
      e.input.values?.['revision'] === req.instructionRevision,
  ).length;

const MEASURES: Readonly<Record<RequirementKind, Measure>> = {
  photo: countAttachments('photo'),
  video: countAttachments('video'),
  document: countAttachments('document'),
  signature: countAttachments('signature'),
  scan: countValues,
  number: countValues,
  text: countValues,
  checklist: countValues,
  event: countEvents,
  acknowledgement: countAcknowledgements,
};

/** Start of the capture window, or +Infinity if its phase was not reached yet. */
function windowStart(stage: StageRun, req: StageRequirement): number {
  if (!req.captureFromPhase) return Number.NEGATIVE_INFINITY;
  return phaseTime(stage, req.captureFromPhase) ?? Number.POSITIVE_INFINITY;
}

export function measure(stage: StageRun, req: StageRequirement, extra?: AppliedEvent): Measurement {
  const events = extra ? [...stage.events, extra] : stage.events;
  return { have: MEASURES[req.kind](req, events, windowStart(stage, req)), need: req.min ?? 1 };
}

export function isFulfilled(m: Measurement): boolean {
  return m.have >= m.need;
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
    (r) => !r.gated && !r.waived && PHASE_RANK[target] >= PHASE_RANK[r.spec.beforePhase],
  );
  const unmet = checked.filter((r) => !isFulfilled(measure(stage, r.spec, candidate)));
  return {
    checked,
    blocking: unmet.filter((r) => r.spec.strictness === 'block'),
    warnings: unmet.filter((r) => r.spec.strictness === 'warn'),
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
    if (!r.gated && !r.waived) {
      r.gated = true;
      r.notApplicable = true;
    }
  }
}

/**
 * Requirements a new stage gets from the catalog rules: by stage type, tags,
 * customer and place. Called once when a trip is created; afterwards they
 * live on the stage and can be edited for that trip.
 */
export function materializeRequirements(stage: StageFacts, trip: TripFacts, catalog: Catalog): StageRequirement[] {
  const subject = ruleSubject(stage, trip);
  const result = new Map<string, StageRequirement>(); // one per template, even if several rules match
  for (const rule of catalog.requirementRules) {
    if (!ruleApplies(rule, subject)) continue;
    const template = catalog.requirementTemplates[rule.template];
    if (!template || result.has(template.code)) continue;
    const { code, ...spec } = template;
    result.set(code, { ...spec, id: `${stage.id}:${code}`, template: code, source: ruleOrigin(rule) });
  }
  return [...result.values()];
}
