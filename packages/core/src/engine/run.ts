/**
 * Mutable runtime model used while replaying the event journal.
 * Nothing outside the engine sees it; results are copied into plain objects.
 */
import type { Catalog, StageType } from '../catalog/types.js';
import { stateForPhase, type StageState } from '../machines/stage-state.js';
import type { Phase } from '../machines/phase.js';
import type { ScopeStage } from './scope.js';
import type { EventInput, StageInput, StageRequirement, TripInput } from './types.js';

export interface AppliedEvent {
  readonly input: EventInput;
  readonly at: number;
}

export interface PauseRun {
  from: number;
  to?: number;
  reason?: string;
  incidentId?: string;
}

export interface RequirementRun {
  readonly spec: StageRequirement;
  waived: boolean;
  /** The gate for this requirement has been passed. */
  gated: boolean;
  violated: boolean;
  /** The stage was left without the work, so the requirement did not apply. */
  notApplicable?: boolean;
}

export interface StageRun {
  readonly input: StageInput;
  readonly type: StageType;
  readonly index: number;
  readonly tags: ReadonlySet<string>;
  state: StageState;
  phase: Phase | null;
  arrivedAt?: number;
  startedAt?: number;
  completedAt?: number;
  departedAt?: number;
  readonly pauses: PauseRun[];
  readonly requirements: RequirementRun[];
  /** Applied events on this stage: the evidence for requirements. */
  readonly events: AppliedEvent[];
}

export interface IncidentRun {
  readonly id: string;
  readonly typeCode: string;
  readonly stageId?: string;
  readonly blocksProgress: boolean;
  readonly openedAt: number;
  state: 'open' | 'acknowledged' | 'resolved';
  resolvedAt?: number;
  pausedStageId?: string;
}

export interface TripRun {
  readonly trip: TripInput;
  readonly catalog: Catalog;
  readonly tags: ReadonlySet<string>;
  readonly stages: StageRun[];
  readonly incidents: Map<string, IncidentRun>;
  readonly flags: { accepted: boolean; closed: boolean; cancelled: boolean };
}

export class UnknownStageTypeError extends Error {
  constructor(readonly stageId: string, readonly typeCode: string) {
    super(`Stage ${stageId} has unknown stage type "${typeCode}"`);
  }
}

export function createRun(trip: TripInput, catalog: Catalog): TripRun {
  const tripTags = new Set(trip.tags ?? []);
  const stages = trip.stages.map((input, index): StageRun => {
    const type = catalog.stageTypes[input.typeCode];
    if (!type) throw new UnknownStageTypeError(input.id, input.typeCode);
    return {
      input,
      type,
      index,
      tags: new Set([...tripTags, ...(input.tags ?? [])]),
      state: 'ahead',
      phase: null,
      pauses: [],
      requirements: (input.requirements ?? []).map((spec) => ({ spec, waived: false, gated: false, violated: false })),
      events: [],
    };
  });
  return {
    trip,
    catalog,
    tags: tripTags,
    stages,
    incidents: new Map(),
    flags: { accepted: false, closed: false, cancelled: false },
  };
}

export function findStage(run: TripRun, id: string | undefined): StageRun | undefined {
  return id === undefined ? undefined : run.stages.find((s) => s.input.id === id);
}

export function currentStage(run: TripRun): StageRun | undefined {
  return run.stages.find((s) => s.state === 'in_progress');
}

export function scopeStage(run: TripRun, stage: StageRun): ScopeStage {
  return {
    kind: stage.type.kind,
    typeCode: stage.type.code,
    transitMode: stage.type.transitMode,
    phase: stage.phase,
    state: stage.state,
    tags: stage.tags,
    assigneeId: stage.input.assigneeId ?? run.trip.driverId,
  };
}

/** Time a phase was (last) reached on a stage. */
export function phaseTime(stage: StageRun, phase: Phase): number | undefined {
  switch (phase) {
    case 'arrived':
      return stage.arrivedAt;
    case 'started':
      return stage.startedAt;
    case 'completed':
      return stage.completedAt;
    case 'departed':
      return stage.departedAt;
    case 'paused':
      return stage.pauses.at(-1)?.from;
    case 'resumed':
      return stage.pauses.at(-1)?.to;
  }
}

function closeOpenPause(stage: StageRun, at: number): void {
  const last = stage.pauses.at(-1);
  if (last && last.to === undefined) last.to = at;
}

/** Moves a stage into a phase and records the milestone. Validation happens before. */
export function enterPhase(stage: StageRun, phase: Phase, at: number, pause?: Omit<PauseRun, 'from'>): void {
  switch (phase) {
    case 'arrived':
      stage.arrivedAt = at;
      break;
    case 'started':
      stage.startedAt ??= at;
      break;
    case 'paused':
      stage.pauses.push({ from: at, ...pause });
      break;
    case 'resumed':
      closeOpenPause(stage, at);
      break;
    case 'completed':
      closeOpenPause(stage, at);
      stage.completedAt = at;
      break;
    case 'departed':
      closeOpenPause(stage, at);
      stage.departedAt = at;
      break;
  }
  stage.phase = phase;
  stage.state = stateForPhase(stage.type.profile, phase);
}

export function skipStage(stage: StageRun, at: number): void {
  closeOpenPause(stage, at);
  stage.state = 'skipped';
}
