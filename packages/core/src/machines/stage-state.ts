/**
 * Stage state machine: where the stage is in the trip.
 *
 *   ahead → in_progress → passed      strictly forward, one step at a time
 *   any   → skipped                   dispatcher only, with a reason
 */
import { isFinalPhase, type Phase, type Profile } from './phase.js';

export const STAGE_STATES = ['ahead', 'in_progress', 'passed', 'skipped'] as const;
export type StageState = (typeof STAGE_STATES)[number];

export interface StageStateTransition {
  readonly from: StageState;
  readonly to: StageState;
  readonly trigger: 'first_phase' | 'final_phase' | 'skip';
}

export const STAGE_STATE_TRANSITIONS: readonly StageStateTransition[] = [
  { from: 'ahead', to: 'in_progress', trigger: 'first_phase' },
  { from: 'in_progress', to: 'passed', trigger: 'final_phase' },
  { from: 'ahead', to: 'skipped', trigger: 'skip' },
  { from: 'in_progress', to: 'skipped', trigger: 'skip' },
  { from: 'passed', to: 'skipped', trigger: 'skip' },
];

/** State implied by a phase (skipping is decided separately). */
export function stateForPhase(profile: Profile, phase: Phase | null): Exclude<StageState, 'skipped'> {
  if (phase === null) return 'ahead';
  return isFinalPhase(profile, phase) ? 'passed' : 'in_progress';
}

export function canSkip(state: StageState): boolean {
  return STAGE_STATE_TRANSITIONS.some((t) => t.trigger === 'skip' && t.from === state);
}

/** No phase events are accepted once a stage is finished. */
export function isClosedState(state: StageState): boolean {
  return state === 'passed' || state === 'skipped';
}
