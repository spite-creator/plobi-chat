/**
 * Shared contract and helpers for event handlers.
 *
 * A handler validates an event against the current run and, if it is valid,
 * returns an `apply` function. Validation never mutates; `apply` does.
 * In `probe` mode (what may the user do now?) form values are not checked.
 */
import type { EventType } from '../../catalog/types.js';
import type { StageState } from '../../machines/stage-state.js';
import { isEmptyValue, missingFields } from '../fields.js';
import { checkScope, scopeNeedsStage } from '../scope.js';
import { findStage, scopeStage, type AppliedEvent, type StageRun, type TripRun } from '../run.js';
import type { Conflict, ConflictReason, EventInput } from '../types.js';

export interface HandlerContext {
  readonly run: TripRun;
  readonly ev: EventInput;
  readonly type: EventType;
  readonly at: number;
  readonly mode: 'apply' | 'probe';
}

export interface Accepted {
  readonly ok: true;
  readonly requirementsUnmet?: readonly string[];
  readonly warnings?: readonly string[];
  /** Applies the event and returns the automatic effects it caused. */
  readonly apply: () => string[];
}

export interface Rejected {
  readonly ok: false;
  readonly conflict: Conflict;
}

export type Outcome = Accepted | Rejected;
export type Handler = (ctx: HandlerContext) => Outcome;

export const reject = (reason: ConflictReason, details?: readonly string[]): Rejected => ({
  ok: false,
  conflict: details ? { reason, details } : { reason },
});

export const isRejected = (x: unknown): x is Rejected =>
  typeof x === 'object' && x !== null && (x as Rejected).ok === false;

export function asApplied(ctx: HandlerContext): AppliedEvent {
  return { input: ctx.ev, at: ctx.at };
}

/** The stage the event refers to; `required` stages must exist. */
export function resolveStage(ctx: HandlerContext, required: boolean): StageRun | undefined | Rejected {
  if (ctx.ev.stageId === undefined) {
    return required || scopeNeedsStage(ctx.type.scope) ? reject('stage_required') : undefined;
  }
  return findStage(ctx.run, ctx.ev.stageId) ?? reject('stage_not_found', [ctx.ev.stageId]);
}

export function checkEventScope(
  ctx: HandlerContext,
  stage: StageRun | undefined,
  defaultStates?: readonly StageState[],
): Rejected | undefined {
  const failed = checkScope(
    ctx.type.scope,
    {
      stage: stage ? scopeStage(ctx.run, stage) : undefined,
      tags: ctx.run.tags,
      role: ctx.ev.authorRole,
      userId: ctx.ev.authorId,
      forced: ctx.ev.forced === true,
    },
    defaultStates ? { states: defaultStates } : {},
  );
  return failed.length > 0 ? reject('out_of_scope', failed) : undefined;
}

export function hasReason(ctx: HandlerContext): boolean {
  return !isEmptyValue(ctx.ev.values?.['reason']);
}

/** Form values are validated only when the event is really applied. */
export function checkFields(ctx: HandlerContext): Rejected | undefined {
  if (ctx.mode === 'probe') return undefined;
  const missing = missingFields(ctx.type.fields, ctx.ev.values, ctx.ev.attachments);
  return missing.length > 0 ? reject('invalid_values', missing) : undefined;
}

/** Reason is mandatory for some actions; not checked when probing. */
export function checkReason(ctx: HandlerContext): Rejected | undefined {
  return ctx.mode === 'apply' && !hasReason(ctx) ? reject('reason_required') : undefined;
}
