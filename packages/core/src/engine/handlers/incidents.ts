/**
 * Incidents run in parallel with phases: open → acknowledged → resolved.
 * An incident may pause the current work (autoPause) and block leaving (blocksProgress).
 */
import { profileHasPhase } from '../../machines/phase.js';
import { currentStage, enterPhase, findStage, type IncidentRun } from '../run.js';
import {
  checkEventScope,
  checkFields,
  isRejected,
  reject,
  resolveStage,
  type Handler,
  type HandlerContext,
  type Rejected,
} from './context.js';

export const incidentOpenHandler: Handler = (ctx) => {
  const incidentType = ctx.type.incidentType ? ctx.run.catalog.incidentTypes[ctx.type.incidentType] : undefined;
  if (!incidentType) return reject('unknown_event_type', [`incident type ${ctx.type.incidentType ?? '(none)'}`]);

  const explicit = resolveStage(ctx, false);
  if (isRejected(explicit)) return explicit;
  const stage = explicit ?? currentStage(ctx.run);

  const scope = checkEventScope(ctx, stage);
  if (scope) return scope;
  const fields = checkFields(ctx);
  if (fields) return fields;

  return {
    ok: true,
    apply: () => {
      const incident: IncidentRun = {
        id: ctx.ev.id,
        typeCode: incidentType.code,
        stageId: stage?.input.id,
        blocksProgress: incidentType.blocksProgress,
        openedAt: ctx.at,
        state: 'open',
      };
      ctx.run.incidents.set(incident.id, incident);

      const working = stage && (stage.phase === 'started' || stage.phase === 'resumed');
      if (incidentType.autoPause && stage && working && profileHasPhase(stage.type.profile, 'paused')) {
        enterPhase(stage, 'paused', ctx.at, { reason: `incident:${incidentType.code}`, incidentId: incident.id });
        incident.pausedStageId = stage.input.id;
        return [`stage:${stage.input.id} paused`];
      }
      return [];
    },
  };
};

function findOpenIncident(ctx: HandlerContext): IncidentRun | Rejected {
  const id = ctx.ev.values?.['incidentId'];
  const incident = typeof id === 'string' ? ctx.run.incidents.get(id) : undefined;
  if (!incident || incident.state === 'resolved') return reject('incident_not_found', [String(id)]);
  return incident;
}

export const incidentAckHandler: Handler = (ctx) => {
  const scope = checkEventScope(ctx, undefined);
  if (scope) return scope;
  const incident = findOpenIncident(ctx);
  if (isRejected(incident)) return incident;

  return {
    ok: true,
    apply: () => {
      incident.state = 'acknowledged';
      return [];
    },
  };
};

export const incidentResolveHandler: Handler = (ctx) => {
  const scope = checkEventScope(ctx, undefined);
  if (scope) return scope;
  const incident = findOpenIncident(ctx);
  if (isRejected(incident)) return incident;
  const fields = checkFields(ctx);
  if (fields) return fields;

  return {
    ok: true,
    apply: () => {
      incident.state = 'resolved';
      incident.resolvedAt = ctx.at;
      const stage = findStage(ctx.run, incident.pausedStageId);
      const pause = stage?.pauses.at(-1);
      if (stage && stage.phase === 'paused' && pause?.incidentId === incident.id && pause.to === undefined) {
        enterPhase(stage, 'resumed', ctx.at);
        return [`stage:${stage.input.id} resumed`];
      }
      return [];
    },
  };
};
