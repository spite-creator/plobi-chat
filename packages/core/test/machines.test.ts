import { describe, expect, it } from 'vitest';
import {
  canSkip,
  canTransition,
  deriveTripState,
  phaseDiagram,
  profileTransitions,
  stateForPhase,
  type Profile,
} from '../src/index.js';

const edges = (p: Profile) => profileTransitions(p).map((t) => `${t.from ?? '∅'}→${t.to}`).sort();

describe('phase profiles', () => {
  it('point_split keeps the full graph', () => {
    expect(edges('point_split')).toEqual(
      [
        '∅→arrived',
        'arrived→started',
        'started→paused',
        'started→completed',
        'paused→resumed',
        'resumed→paused',
        'resumed→completed',
        'completed→departed',
      ].sort(),
    );
  });

  it('point_single glues "completed" away: departure straight from work', () => {
    expect(canTransition('point_single', 'started', 'departed')).toBe(true);
    expect(canTransition('point_single', 'resumed', 'departed')).toBe(true);
    expect(canTransition('point_single', 'paused', 'departed')).toBe(false);
    expect(canTransition('point_single', 'started', 'completed')).toBe(false);
  });

  it('point_simple is arrived → departed', () => {
    expect(edges('point_simple')).toEqual(['arrived→departed', '∅→arrived']);
  });

  it('transit enters at started and ends at completed, no arrived/departed', () => {
    expect(edges('transit')).toEqual(
      ['∅→started', 'paused→resumed', 'resumed→completed', 'resumed→paused', 'started→completed', 'started→paused'].sort(),
    );
  });

  it('diagram is generated from the same transitions', () => {
    const diagram = phaseDiagram('point_single');
    expect(diagram).toContain('started --> departed');
    expect(diagram).not.toContain('completed');
  });
});

describe('stage state', () => {
  it('follows phases strictly forward', () => {
    expect(stateForPhase('point_split', null)).toBe('ahead');
    expect(stateForPhase('point_split', 'completed')).toBe('in_progress');
    expect(stateForPhase('point_split', 'departed')).toBe('passed');
    expect(stateForPhase('transit', 'completed')).toBe('passed');
  });

  it('can be skipped from any state except skipped', () => {
    expect(['ahead', 'in_progress', 'passed', 'skipped'].map((s) => canSkip(s as never))).toEqual([true, true, true, false]);
  });
});

describe('trip state', () => {
  const flags = { hasDriver: true, accepted: true, closed: false, cancelled: false };
  it('is derived from stages and flags', () => {
    expect(deriveTripState({ ...flags, accepted: false, hasDriver: false }, ['ahead'])).toBe('draft');
    expect(deriveTripState({ ...flags, accepted: false }, ['ahead'])).toBe('assigned');
    expect(deriveTripState(flags, ['ahead'])).toBe('accepted');
    expect(deriveTripState(flags, ['in_progress', 'ahead'])).toBe('in_progress');
    expect(deriveTripState(flags, ['passed', 'skipped'])).toBe('finished');
    expect(deriveTripState({ ...flags, closed: true }, ['passed'])).toBe('closed');
    expect(deriveTripState({ ...flags, cancelled: true }, ['in_progress'])).toBe('cancelled');
  });
});
