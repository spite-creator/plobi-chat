/**
 * Trip state: derived from stage states and a few explicit trip events.
 */
import type { StageState } from './stage-state.js';

export const TRIP_STATES = [
  'draft',
  'assigned',
  'accepted',
  'in_progress',
  'finished',
  'closed',
  'cancelled',
] as const;
export type TripState = (typeof TRIP_STATES)[number];

export const TRIP_STATE_TRANSITIONS: ReadonlyArray<{ from: TripState; to: TripState; trigger: string }> = [
  { from: 'draft', to: 'assigned', trigger: 'driver assigned' },
  { from: 'assigned', to: 'accepted', trigger: 'driver accepted' },
  { from: 'assigned', to: 'draft', trigger: 'driver declined' },
  { from: 'accepted', to: 'in_progress', trigger: 'first stage in progress' },
  { from: 'in_progress', to: 'finished', trigger: 'all stages passed or skipped' },
  { from: 'finished', to: 'closed', trigger: 'dispatcher closed the trip' },
  { from: 'draft', to: 'cancelled', trigger: 'cancelled' },
  { from: 'assigned', to: 'cancelled', trigger: 'cancelled' },
  { from: 'accepted', to: 'cancelled', trigger: 'cancelled' },
  { from: 'in_progress', to: 'cancelled', trigger: 'cancelled with a reason' },
];

export interface TripFlags {
  readonly hasDriver: boolean;
  readonly accepted: boolean;
  readonly closed: boolean;
  readonly cancelled: boolean;
}

export function allStagesDone(states: readonly StageState[]): boolean {
  return states.length > 0 && states.every((s) => s === 'passed' || s === 'skipped');
}

export function deriveTripState(flags: TripFlags, stageStates: readonly StageState[]): TripState {
  if (flags.cancelled) return 'cancelled';
  if (allStagesDone(stageStates)) return flags.closed ? 'closed' : 'finished';
  if (stageStates.some((s) => s !== 'ahead')) return 'in_progress';
  if (flags.accepted) return 'accepted';
  return flags.hasDriver ? 'assigned' : 'draft';
}
