/**
 * The engine: phase and state are a pure function of the ordered event journal.
 *
 * Events are replayed in occurredAt order. An event that does not fit the
 * machines at its place in time is kept as a conflict and has no effect;
 * nothing is ever dropped.
 */
import type { Catalog } from '../catalog/types.js';
import { deriveTripState } from '../machines/trip-state.js';
import { HANDLERS } from './handlers/index.js';
import { reject, type Outcome } from './handlers/context.js';
import { isFulfilled, isVisible, measure, strictnessOf } from './requirements.js';
import { createRun, currentStage, effectiveAssignee, effectiveMode, findStage, type StageRun, type TripRun } from './run.js';
import type { EventInput, EventResult, StageResult, TripInput, TripResult } from './types.js';

const iso = (ms: number | undefined): string | undefined => (ms === undefined ? undefined : new Date(ms).toISOString());

/** Chronological order; ties by receivedAt, then id, so replay is deterministic. Duplicate ids are ignored. */
export function orderEvents(events: readonly EventInput[]): EventInput[] {
  const unique = new Map<string, EventInput>();
  for (const ev of events) if (!unique.has(ev.id)) unique.set(ev.id, ev);
  return [...unique.values()].sort(
    (a, b) =>
      Date.parse(a.occurredAt) - Date.parse(b.occurredAt) ||
      (a.receivedAt ?? '').localeCompare(b.receivedAt ?? '') ||
      a.id.localeCompare(b.id),
  );
}

/** Validates one event against the run without changing it. */
export function check(run: TripRun, ev: EventInput, mode: 'apply' | 'probe'): Outcome {
  const type = run.catalog.eventTypes[ev.typeCode];
  if (!type) return reject('unknown_event_type', [ev.typeCode]);
  if (run.flags.cancelled || run.flags.closed) return reject('trip_locked');
  return HANDLERS[type.action]({ run, ev, type, at: Date.parse(ev.occurredAt), mode });
}

function step(run: TripRun, ev: EventInput): EventResult {
  const outcome = check(run, ev, 'apply');
  if (!outcome.ok) {
    return { eventId: ev.id, typeCode: ev.typeCode, result: 'conflict', conflict: outcome.conflict, effects: [] };
  }
  const effects = outcome.apply();
  findStage(run, ev.stageId)?.events.push({ input: ev, at: Date.parse(ev.occurredAt) });
  return {
    eventId: ev.id,
    typeCode: ev.typeCode,
    result: 'applied',
    ...(outcome.requirementsUnmet ? { requirementsUnmet: outcome.requirementsUnmet } : {}),
    ...(outcome.warnings ? { warnings: outcome.warnings } : {}),
    effects,
  };
}

/** Replays the journal and returns the run for further queries. */
export function replay(trip: TripInput, events: readonly EventInput[], catalog: Catalog) {
  const run = createRun(trip, catalog);
  const results = orderEvents(events).map((ev) => step(run, ev));
  return { run, results };
}

function stageResult(run: TripRun, stage: StageRun): StageResult {
  return {
    id: stage.input.id,
    typeCode: stage.type.code,
    kind: stage.type.kind,
    profile: stage.type.profile,
    state: stage.state,
    phase: stage.phase,
    assigneeId: effectiveAssignee(run, stage),
    mode: effectiveMode(stage),
    ...(stage.autoPassed ? { autoPassed: true } : {}),
    arrivedAt: iso(stage.arrivedAt),
    startedAt: iso(stage.startedAt),
    completedAt: iso(stage.completedAt),
    departedAt: iso(stage.departedAt),
    pauses: stage.pauses.map((p) => ({
      from: iso(p.from) as string,
      to: iso(p.to),
      reason: p.reason,
      incidentId: p.incidentId,
    })),
    pausedMs: stage.pauses.reduce((sum, p) => sum + (p.to === undefined ? 0 : p.to - p.from), 0),
    requirements: stage.requirements.map((r) => {
      const m = measure(stage, r.spec);
      return {
        id: r.spec.id,
        kind: r.spec.kind,
        title: r.spec.title,
        revision: r.spec.revision ?? 1,
        visible: isVisible(r.spec.showAt, stage.phase),
        ...(r.spec.beforePhase ? { beforePhase: r.spec.beforePhase } : {}),
        strictness: strictnessOf(r.spec),
        fulfilled: r.waived || isFulfilled(m),
        have: m.have,
        need: m.need,
        waived: r.waived,
        violated: r.violated,
        notApplicable: r.notApplicable === true,
      };
    }),
  };
}

export function evaluateTrip(trip: TripInput, events: readonly EventInput[], catalog: Catalog): TripResult {
  const { run, results } = replay(trip, events, catalog);
  const stages = run.stages.map((s) => stageResult(run, s));
  return {
    state: deriveTripState(
      { hasDriver: trip.driverId !== undefined, ...run.flags },
      stages.map((s) => s.state),
    ),
    currentStageId: currentStage(run)?.input.id,
    stages,
    events: results,
    incidents: [...run.incidents.values()].map((i) => ({
      id: i.id,
      typeCode: i.typeCode,
      stageId: i.stageId,
      state: i.state,
      blocksProgress: i.blocksProgress,
      openedAt: iso(i.openedAt) as string,
      resolvedAt: iso(i.resolvedAt),
    })),
  };
}
