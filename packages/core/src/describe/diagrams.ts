/**
 * Diagrams for the admin "Automata" section, generated from the machines
 * themselves, so a drawing can never drift from the behaviour.
 */
import { PROFILE_PHASES, profileTransitions, FINAL_PHASE, type Phase, type Profile } from '../machines/phase.js';
import { STAGE_STATE_TRANSITIONS } from '../machines/stage-state.js';
import { TRIP_STATE_TRANSITIONS } from '../machines/trip-state.js';

export type EdgeLabel = (from: Phase | null, to: Phase) => string | undefined;

const line = (from: string, to: string, label?: string) => `    ${from} --> ${to}${label ? `: ${label}` : ''}`;

/** Mermaid stateDiagram of a phase profile. `label` adds text to edges (e.g. event names). */
export function phaseDiagram(profile: Profile, label?: EdgeLabel): string {
  const lines = ['stateDiagram-v2'];
  for (const t of profileTransitions(profile)) {
    lines.push(line(t.from ?? '[*]', t.to, label?.(t.from, t.to)));
  }
  lines.push(line(FINAL_PHASE[profile], '[*]'));
  return lines.join('\n');
}

export function stageStateDiagram(): string {
  return [
    'stateDiagram-v2',
    line('[*]', 'ahead'),
    ...STAGE_STATE_TRANSITIONS.map((t) => line(t.from, t.to, t.trigger)),
    line('passed', '[*]'),
    line('skipped', '[*]'),
  ].join('\n');
}

export function tripStateDiagram(): string {
  return [
    'stateDiagram-v2',
    line('[*]', 'draft'),
    ...TRIP_STATE_TRANSITIONS.map((t) => line(t.from, t.to, t.trigger)),
  ].join('\n');
}

/** Machine-readable description for the API (`GET /state-machines`). */
export function describeMachines() {
  return {
    stageStates: STAGE_STATE_TRANSITIONS,
    tripStates: TRIP_STATE_TRANSITIONS,
    profiles: Object.fromEntries(
      (Object.keys(PROFILE_PHASES) as Profile[]).map((p) => [
        p,
        { phases: PROFILE_PHASES[p], final: FINAL_PHASE[p], transitions: profileTransitions(p) },
      ]),
    ),
  };
}
