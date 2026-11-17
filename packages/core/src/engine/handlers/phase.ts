/**
 * Phase and detail events: where they go and what phase they set.
 *
 * Placement (see placement.ts) finds the stage. Then Plobi's own checks run
 * on it — roles and assignee, open incidents, requirements, the event form —
 * and the phase is set by the engine rules:
 * - phases only go forward; pause from started / resumed, resume from paused;
 *   a phase the stage's profile does not have: accepted, phase unchanged;
 * - a phase on a stage means everything before it is passed: earlier stages
 *   get their final phase automatically (so the running transit and a fast
 *   border crossing close themselves);
 * - a stop on a transit that has not started yet first starts it;
 * - a second stop during a pause does not open a new one, it changes the reason;
 * - the last stage completed is also departed;
 * - a point passed starts the next transit.
 */
import type { Phase } from '../../machines/phase.js';
import { profileHasPhase } from '../../machines/phase.js';
import { checkScope } from '../scope.js';
import { finalPhase, fits, fitsPause, isPassed, place, reached } from '../placement.js';
import { gate, markGated, markNotApplicable, NOTHING_GATED } from '../requirements.js';
import { enterPhase, findStage, scopeStage, type StageRun, type TripRun } from '../run.js';
import {
  asApplied,
  checkFields,
  hasReason,
  reject,
  type Handler,
  type HandlerContext,
  type Rejected,
} from './context.js';

/** "In transit" on a transit standing on a pause means resumed: the driver is moving again. */
function effectivePhase(ctx: HandlerContext, stage: StageRun): Phase | undefined {
  const phase = ctx.type.setsPhase;
  if (ctx.type.placement === 'road' && phase === 'started' && stage.type.kind === 'transit' && stage.phase === 'paused') {
    return 'resumed';
  }
  return phase;
}

/** Placement already used the stage-type labels; here only who may submit, and tags. */
function checkWho(ctx: HandlerContext, stage: StageRun): Rejected | undefined {
  const s = ctx.type.scope ?? {};
  const failed = checkScope(
    {
      ...(s.roles ? { roles: s.roles } : {}),
      ...(s.assigneeOnly ? { assigneeOnly: true } : {}),
      ...(s.tagsRequired ? { tagsRequired: s.tagsRequired } : {}),
      ...(s.tagsExcluded ? { tagsExcluded: s.tagsExcluded } : {}),
      ...(s.transportModes && stage.type.kind === 'transit' ? { transportModes: s.transportModes } : {}),
    },
    {
      stage: scopeStage(ctx.run, stage),
      tags: ctx.run.tags,
      role: ctx.ev.authorRole,
      userId: ctx.ev.authorId,
      forced: ctx.ev.forced === true,
    },
  );
  return failed.length > 0 ? reject('out_of_scope', failed) : undefined;
}

/** The event names its stage (types without placement). */
function explicitStage(ctx: HandlerContext): { stage: StageRun; canSet: boolean; note?: string } | Rejected {
  if (!ctx.ev.stageId) return reject('stage_required');
  const stage = findStage(ctx.run, ctx.ev.stageId);
  if (!stage) return reject('stage_not_found', [ctx.ev.stageId]);
  if (isPassed(stage)) return reject('stage_closed');
  if (!fits(stage, ctx.type.setsPhase)) return reject('invalid_transition', [`${stage.phase ?? 'none'} → ${ctx.type.setsPhase}`]);
  return { stage, canSet: ctx.type.setsPhase !== undefined };
}

function blockingIncidents(run: TripRun, stage: StageRun): string[] {
  return [...run.incidents.values()]
    .filter((i) => i.state !== 'resolved' && i.blocksProgress)
    .filter((i) => i.stageId === undefined || i.stageId === stage.input.id)
    .map((i) => i.id);
}

/** Leaving a point right after arrival without doing the work, in a profile that has work. */
function isDepartureWithoutWork(stage: StageRun, phase: Phase): boolean {
  return stage.phase === 'arrived' && phase === 'departed' && profileHasPhase(stage.type.profile, 'started');
}

export const phaseHandler: Handler = (ctx) => {
  const placed = ctx.type.placement ? place(ctx.run, ctx.type) : explicitStage(ctx);
  if ('ok' in placed) return placed;
  if (!placed.stage) return reject('not_placed', [placed.note]);

  const { stage } = placed;
  const who = checkWho(ctx, stage);
  if (who) return who;

  const phase = effectivePhase(ctx, stage);
  let canSet = placed.canSet && phase !== undefined;
  let note = placed.note;
  if (canSet && phase && !profileHasPhase(stage.type.profile, phase)) {
    canSet = false;
    note ??= `У этапа «${stage.type.code}» нет фазы «${phase}»: фаза не меняется`;
  }

  let gated = NOTHING_GATED;
  let withoutWork = false;
  if (canSet && phase) {
    if (ctx.ev.forced && ctx.mode === 'apply' && !hasReason(ctx)) return reject('reason_required');

    withoutWork = isDepartureWithoutWork(stage, phase);
    if (withoutWork) {
      const policy = stage.type.departWithoutWork ?? 'with_reason';
      if (policy === 'deny') return reject('invalid_transition', ['arrived → departed: no departure without work']);
      if (policy === 'with_reason' && ctx.mode === 'apply' && !hasReason(ctx)) return reject('reason_required');
    }

    if (phase === finalPhase(stage) && !ctx.ev.forced) {
      const blockers = blockingIncidents(ctx.run, stage);
      if (blockers.length > 0) return reject('blocked_by_incident', blockers);
    }

    if (!withoutWork) {
      gated = gate(stage, phase, asApplied(ctx));
      const unmet = gated.blocking.map((r) => r.spec.id);
      const mayPass = ctx.ev.forced === true || ctx.ev.acceptUnmet === true || ctx.mode === 'probe';
      if (unmet.length > 0 && !mayPass) return reject('requirements_unmet', unmet);
    }
  }

  const fields = checkFields(ctx);
  if (fields) return fields;

  const unmet = gated.blocking.map((r) => r.spec.id);
  return {
    ok: true,
    stageId: stage.input.id,
    ...(note ? { note } : {}),
    ...(unmet.length > 0 ? { requirementsUnmet: unmet } : {}),
    ...(gated.warnings.length > 0 ? { warnings: gated.warnings.map((r) => r.spec.id) } : {}),
    apply: () => {
      const run = ctx.run;
      run.accepted.push({ code: ctx.type.code, stage: stage.index });
      if (ctx.type.placement === 'point' || (ctx.type.placement === 'road' && canSet)) {
        run.cursor = Math.max(run.cursor, stage.index);
      }
      if (!canSet || !phase) return [];
      const effects = setPhase(ctx, stage, phase);
      if (withoutWork) markNotApplicable(stage);
      else markGated(gated);
      return effects;
    },
  };
};

function setPhase(ctx: HandlerContext, stage: StageRun, phase: Phase): string[] {
  const { run, at } = ctx;
  const effects: string[] = [];
  const change = (s: StageRun, p: Phase, implied: boolean, pause?: { reason?: string; fault?: string }) => {
    enterPhase(s, p, at, pause);
    effects.push(`stage:${s.input.id} ${p}${implied ? ' (auto)' : ''}`);
  };

  // Everything before the stage is passed: the final phase of each one's profile.
  for (const earlier of run.stages.slice(0, stage.index)) {
    if (isPassed(earlier)) continue;
    if (earlier.type.kind === 'transit' && earlier.phase === null) enterPhase(earlier, 'started', at);
    change(earlier, finalPhase(earlier), true);
    earlier.autoPassed = true;
    // Requirements the earlier stage still had are recorded as violated (not blocking: it is already behind).
    markGated(gate(earlier, finalPhase(earlier), { input: { ...ctx.ev, attachments: [], values: {} }, at }));
  }

  // A stop on a transit that has not started: first "started" — the vehicle left the point and stopped.
  // At a point there is no pause before the work starts: that is waiting, counted by the machine itself.
  if ((phase === 'paused' || phase === 'resumed') && stage.type.kind === 'transit' && !isPassed(stage) && !reached(stage, 'started')) {
    change(stage, 'started', true);
  }

  const stop = { reason: ctx.type.code, ...faultOf(ctx) };
  if (phase === 'paused' || phase === 'resumed') {
    if (fitsPause(stage, phase)) change(stage, phase, false, phase === 'paused' ? stop : undefined);
    // A second stop during a pause does not open a new one, it changes the reason.
    else if (phase === 'paused' && stage.phase === 'paused') Object.assign(stage.pauses.at(-1) ?? {}, stop);
  } else if (fits(stage, phase)) {
    change(stage, phase, false, hasReason(ctx) ? { reason: String(ctx.ev.values?.['reason']) } : undefined);
  }

  // The last stage completed is also departed: there is nowhere further to go.
  if (stage.index === run.stages.length - 1 && !isPassed(stage) && stage.phase === 'completed') {
    change(stage, finalPhase(stage), true);
  }

  // A point passed: the next transit starts.
  const next = run.stages[stage.index + 1];
  if (isPassed(stage) && stage.type.kind === 'point' && next?.type.kind === 'transit' && next.phase === null) {
    change(next, 'started', true);
  }
  return effects;
}

function faultOf(ctx: HandlerContext): { fault?: string } {
  const fault = ctx.ev.values?.['fault'] ?? ctx.type.defaultFault;
  return typeof fault === 'string' ? { fault } : {};
}
