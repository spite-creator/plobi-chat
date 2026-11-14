/**
 * Phase events: move the phase machine of a stage.
 *
 * Also handles stage boundaries: "departed" from a point starts the next
 * transit, and "arrived" at a point completes the transit before it.
 */
import { canTransition, FINAL_PHASE, type Phase } from '../../machines/phase.js';
import { isClosedState } from '../../machines/stage-state.js';
import { gate, markGated, markNotApplicable, NOTHING_GATED } from '../requirements.js';
import { enterPhase, type StageRun, type TripRun } from '../run.js';
import {
  asApplied,
  checkEventScope,
  checkFields,
  hasReason,
  isRejected,
  reject,
  resolveStage,
  type Handler,
  type HandlerContext,
  type Rejected,
} from './context.js';

/**
 * Previous stages must be finished. The one exception: an in-progress transit
 * right before a point is completed automatically by the arrival.
 */
function checkEntry(run: TripRun, stage: StageRun): { autoComplete?: StageRun } | Rejected {
  const open = run.stages.slice(0, stage.index).filter((s) => !isClosedState(s.state));
  const [first] = open;
  if (!first) return {};
  if (open.length === 1 && first.state === 'in_progress' && first.type.kind === 'transit' && stage.type.kind === 'point') {
    return { autoComplete: first };
  }
  return reject('order_violation', [first.input.id]);
}

/** Leaving a point right after arrival, without doing the work. */
function isDepartureWithoutWork(stage: StageRun, target: Phase): boolean {
  return stage.type.kind === 'point' && stage.phase === 'arrived' && target === 'departed';
}

function checkTransition(ctx: HandlerContext, stage: StageRun, target: Phase): Rejected | undefined {
  const from = stage.phase;
  if (canTransition(stage.type.profile, from, target)) return undefined;

  if (isDepartureWithoutWork(stage, target)) {
    const policy = stage.type.departWithoutWork ?? 'with_reason';
    if (policy === 'allow') return undefined;
    if (policy === 'with_reason') return ctx.mode === 'probe' || hasReason(ctx) ? undefined : reject('reason_required');
  }
  return reject('invalid_transition', [`${from ?? 'none'} → ${target}`]);
}

function blockingIncidents(run: TripRun, stage: StageRun): string[] {
  return [...run.incidents.values()]
    .filter((i) => i.state !== 'resolved' && i.blocksProgress)
    .filter((i) => i.stageId === undefined || i.stageId === stage.input.id)
    .map((i) => i.id);
}

function startNextTransit(run: TripRun, stage: StageRun, at: number): string[] {
  const next = run.stages[stage.index + 1];
  if (!next || next.type.kind !== 'transit' || next.state !== 'ahead') return [];
  enterPhase(next, 'started', at);
  return [`stage:${next.input.id} started`];
}

function completeTransit(transit: StageRun, at: number): string[] {
  enterPhase(transit, 'completed', at);
  return [`stage:${transit.input.id} completed`];
}

export const phaseHandler: Handler = (ctx) => {
  const target = ctx.type.setsPhase;
  if (!target) return reject('invalid_transition', ['event type has no target phase']);

  const stage = resolveStage(ctx, true);
  if (isRejected(stage)) return stage;
  if (!stage) return reject('stage_required');

  const scope = checkEventScope(ctx, stage);
  if (scope) return scope;
  if (isClosedState(stage.state)) return reject('stage_closed');

  const transition = checkTransition(ctx, stage, target);
  if (transition) return transition;
  if (ctx.ev.forced && ctx.mode === 'apply' && !hasReason(ctx)) return reject('reason_required');

  let autoComplete: StageRun | undefined;
  if (stage.phase === null) {
    const entry = checkEntry(ctx.run, stage);
    if (isRejected(entry)) return entry;
    autoComplete = entry.autoComplete;
  }

  if (target === FINAL_PHASE[stage.type.profile] && !ctx.ev.forced) {
    const blockers = blockingIncidents(ctx.run, stage);
    if (blockers.length > 0) return reject('blocked_by_incident', blockers);
  }

  // No work was done, so work requirements do not apply; the reason is the evidence.
  const withoutWork = isDepartureWithoutWork(stage, target) && stage.type.profile !== 'point_simple';
  const gated = withoutWork ? NOTHING_GATED : gate(stage, target, asApplied(ctx));
  const unmet = gated.blocking.map((r) => r.spec.id);
  const mayPassUnmet = ctx.ev.forced === true || ctx.ev.acceptUnmet === true || ctx.mode === 'probe';
  if (unmet.length > 0 && !mayPassUnmet) return reject('requirements_unmet', unmet);

  const fields = checkFields(ctx);
  if (fields) return fields;

  return {
    ok: true,
    ...(unmet.length > 0 ? { requirementsUnmet: unmet } : {}),
    ...(gated.warnings.length > 0 ? { warnings: gated.warnings.map((r) => r.spec.id) } : {}),
    apply: () => {
      const effects = autoComplete ? completeTransit(autoComplete, ctx.at) : [];
      const reason = ctx.ev.values?.['reason'];
      enterPhase(stage, target, ctx.at, typeof reason === 'string' ? { reason } : {});
      if (withoutWork) markNotApplicable(stage);
      else markGated(gated);
      if (target === 'departed') effects.push(...startNextTransit(ctx.run, stage, ctx.at));
      return effects;
    },
  };
};
