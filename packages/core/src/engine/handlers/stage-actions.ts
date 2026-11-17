/**
 * Detail, skip and waive: events that act on a stage without moving its phase.
 */
import { canSkip } from '../../machines/stage-state.js';
import { isWaivable } from '../requirements.js';
import { skipStage } from '../run.js';
import {
  checkEventScope,
  checkFields,
  checkReason,
  isRejected,
  reject,
  resolveStage,
  type Handler,
} from './context.js';

/** Adds information or evidence. By default only on the current stage. */
export const detailHandler: Handler = (ctx) => {
  const stage = resolveStage(ctx, false);
  if (isRejected(stage)) return stage;

  const scope = checkEventScope(ctx, stage, ['in_progress']);
  if (scope) return scope;

  const fields = checkFields(ctx);
  if (fields) return fields;

  return { ok: true, ...(stage ? { stageId: stage.input.id } : {}), apply: () => [] };
};

/** Dispatcher skips a stage from any state. An automatic transit right after a skipped point is skipped too. */
export const skipHandler: Handler = (ctx) => {
  const stage = resolveStage(ctx, true);
  if (isRejected(stage)) return stage;
  if (!stage) return reject('stage_required');

  const scope = checkEventScope(ctx, stage, ['ahead', 'in_progress', 'passed']);
  if (scope) return scope;
  if (!canSkip(stage.state)) return reject('stage_closed');

  const reason = checkReason(ctx);
  if (reason) return reason;

  return {
    ok: true,
    stageId: stage.input.id,
    apply: () => {
      skipStage(stage, ctx.at);
      const next = ctx.run.stages[stage.index + 1];
      if (stage.type.kind === 'point' && next?.type.kind === 'transit' && next.input.isAuto && next.state === 'ahead') {
        skipStage(next, ctx.at);
        return [`stage:${next.input.id} skipped`];
      }
      return [];
    },
  };
};

/** Dispatcher removes a requirement from a stage (values.requirementId, values.reason). */
export const waiveHandler: Handler = (ctx) => {
  const stage = resolveStage(ctx, true);
  if (isRejected(stage)) return stage;
  if (!stage) return reject('stage_required');

  const scope = checkEventScope(ctx, stage, ['ahead', 'in_progress']);
  if (scope) return scope;

  const requirementId = ctx.ev.values?.['requirementId'];
  const requirement = stage.requirements.find((r) => r.spec.id === requirementId);
  if (ctx.mode === 'apply') {
    if (!requirement) return reject('requirement_not_found', [String(requirementId)]);
    if (!isWaivable(requirement.spec)) return reject('out_of_scope', ['not_waivable']);
  }

  const reason = checkReason(ctx);
  if (reason) return reason;

  return {
    ok: true,
    stageId: stage.input.id,
    apply: () => {
      if (requirement) requirement.waived = true;
      return [];
    },
  };
};
