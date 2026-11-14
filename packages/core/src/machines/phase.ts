/**
 * Phase machine.
 *
 * A phase is the last milestone reached on a stage. There is ONE phase graph
 * for every stage; a profile is a subset of its phases. Transitions that pass
 * through phases removed by a profile are "glued" together, so the graph never
 * has to be redefined per stage type.
 */

export const PHASES = ['arrived', 'started', 'paused', 'resumed', 'completed', 'departed'] as const;
export type Phase = (typeof PHASES)[number];

export const PROFILES = ['point_split', 'point_single', 'point_simple', 'transit'] as const;
export type Profile = (typeof PROFILES)[number];

/** Virtual node: the stage has no phase yet. */
export const NO_PHASE = null;
type From = Phase | typeof NO_PHASE;

export interface PhaseTransition {
  readonly from: From;
  readonly to: Phase;
}

/** The full graph. Edges from `null` are entry points. */
export const FULL_PHASE_GRAPH: readonly PhaseTransition[] = [
  { from: null, to: 'arrived' },
  { from: 'arrived', to: 'started' },
  { from: 'started', to: 'paused' },
  { from: 'resumed', to: 'paused' },
  { from: 'paused', to: 'resumed' },
  { from: 'started', to: 'completed' },
  { from: 'resumed', to: 'completed' },
  { from: 'completed', to: 'departed' },
];

export const PROFILE_PHASES: Readonly<Record<Profile, readonly Phase[]>> = {
  point_split: ['arrived', 'started', 'paused', 'resumed', 'completed', 'departed'],
  point_single: ['arrived', 'started', 'paused', 'resumed', 'departed'],
  point_simple: ['arrived', 'departed'],
  transit: ['started', 'paused', 'resumed', 'completed'],
};

export const FINAL_PHASE: Readonly<Record<Profile, Phase>> = {
  point_split: 'departed',
  point_single: 'departed',
  point_simple: 'departed',
  transit: 'completed',
};

/**
 * Chronological rank. `paused` and `resumed` share a rank: they alternate
 * inside the work and neither is "later" than the other.
 */
export const PHASE_RANK: Readonly<Record<Phase, number>> = {
  arrived: 1,
  started: 2,
  paused: 3,
  resumed: 3,
  completed: 4,
  departed: 5,
};

const transitionsCache = new Map<Profile, readonly PhaseTransition[]>();

/** Transitions of a profile, with removed phases glued out of the full graph. */
export function profileTransitions(profile: Profile): readonly PhaseTransition[] {
  const cached = transitionsCache.get(profile);
  if (cached) return cached;

  const kept = new Set<Phase>(PROFILE_PHASES[profile]);
  const sources: From[] = [null, ...PROFILE_PHASES[profile]];
  const result: PhaseTransition[] = [];

  for (const source of sources) {
    const visited = new Set<Phase>();
    const stack: From[] = [source];
    while (stack.length > 0) {
      const node = stack.pop() as From;
      for (const edge of FULL_PHASE_GRAPH) {
        if (edge.from !== node || visited.has(edge.to)) continue;
        visited.add(edge.to);
        if (kept.has(edge.to)) {
          result.push({ from: source, to: edge.to });
        } else {
          stack.push(edge.to); // removed phase: glue through it
        }
      }
    }
  }

  transitionsCache.set(profile, result);
  return result;
}

export function canTransition(profile: Profile, from: From, to: Phase): boolean {
  return profileTransitions(profile).some((t) => t.from === from && t.to === to);
}

export function isFinalPhase(profile: Profile, phase: Phase | null): boolean {
  return phase !== null && FINAL_PHASE[profile] === phase;
}

export function profileHasPhase(profile: Profile, phase: Phase): boolean {
  return PROFILE_PHASES[profile].includes(phase);
}
