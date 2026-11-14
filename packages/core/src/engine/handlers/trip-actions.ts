/**
 * Trip-level events: accept, close, cancel.
 */
import { allStagesDone } from '../../machines/trip-state.js';
import { checkEventScope, checkReason, reject, type Handler } from './context.js';

export const tripAcceptHandler: Handler = (ctx) => {
  const scope = checkEventScope(ctx, undefined);
  if (scope) return scope;
  return {
    ok: true,
    apply: () => {
      ctx.run.flags.accepted = true;
      return [];
    },
  };
};

export const tripCloseHandler: Handler = (ctx) => {
  const scope = checkEventScope(ctx, undefined);
  if (scope) return scope;
  if (!allStagesDone(ctx.run.stages.map((s) => s.state))) return reject('trip_not_finished');
  return {
    ok: true,
    apply: () => {
      ctx.run.flags.closed = true;
      return [];
    },
  };
};

export const tripCancelHandler: Handler = (ctx) => {
  const scope = checkEventScope(ctx, undefined);
  if (scope) return scope;
  const reason = checkReason(ctx);
  if (reason) return reason;
  return {
    ok: true,
    apply: () => {
      ctx.run.flags.cancelled = true;
      return [];
    },
  };
};
