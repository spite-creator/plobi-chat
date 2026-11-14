/**
 * Handler registry: one handler per event action.
 * A new action means a new handler here; the engine itself does not change.
 */
import type { EventAction } from '../../catalog/types.js';
import type { Handler } from './context.js';
import { incidentAckHandler, incidentOpenHandler, incidentResolveHandler } from './incidents.js';
import { phaseHandler } from './phase.js';
import { detailHandler, skipHandler, waiveHandler } from './stage-actions.js';
import { tripAcceptHandler, tripCancelHandler, tripCloseHandler } from './trip-actions.js';

export const HANDLERS: Readonly<Record<EventAction, Handler>> = {
  phase: phaseHandler,
  detail: detailHandler,
  skip: skipHandler,
  waive: waiveHandler,
  incident_open: incidentOpenHandler,
  incident_ack: incidentAckHandler,
  incident_resolve: incidentResolveHandler,
  trip_accept: tripAcceptHandler,
  trip_close: tripCloseHandler,
  trip_cancel: tripCancelHandler,
};

export type { Handler, HandlerContext, Outcome } from './context.js';
