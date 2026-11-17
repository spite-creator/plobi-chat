/**
 * Placement: which stage an event belongs to. The sender only says what
 * happened and when; the engine finds the stage on the route.
 *
 * The route is split into segments by handovers: the one who carries the cargo
 * changes at a handover, and the takeover is the first stage of the next
 * segment (there is no transit between them). The current segment is the
 * cursor's; once the handover is completed, the cargo has been handed over and
 * the current segment is the next one.
 *
 * - point: the nearest stage of the event's types from the cursor on the
 *   current segment that the event's phase still fits. Such a stage exists on
 *   the segment but is already marked: the same event type was on it — a
 *   repeat (same stage, no phase), otherwise a conflict. No such stage on the
 *   segment: an unloading event goes to the handover that ends it; otherwise
 *   the nearest such stage on the next segments; none — a conflict.
 * - road: the transit after the current point. It does not jump over a point
 *   not reached yet (the next stage is a point with no road to it: the event
 *   goes to the current stage without a phase); a takeover after a completed
 *   handover is jumped over (the receiving driver is already driving). While
 *   the vehicle is at a point and its work is not completed, a phase event
 *   ("in transit") goes to the point without a phase and other road events are
 *   a conflict; once the work is completed, a road event means it drove off.
 * - here: the current stage, without a phase of its own choosing.
 */
import type { EventType, StageType } from '../catalog/types.js';
import { PHASE_RANK, FINAL_PHASE, profileHasPhase, type Phase } from '../machines/phase.js';
import { isClosedState } from '../machines/stage-state.js';
import type { StageRun, TripRun } from './run.js';

/** Stage types the engine treats by meaning, not only by profile. */
export const UNLOADING = 'unloading';

export const isPassed = (s: StageRun) => isClosedState(s.state);

/** Has the stage reached the phase (or later)? A passed stage always has. */
export function reached(s: StageRun, phase: Phase): boolean {
  return isPassed(s) || (s.phase !== null && PHASE_RANK[s.phase] >= PHASE_RANK[phase]);
}

/**
 * Does the event's phase fit the stage: not passed, and forward by the machine
 * (pause from started / resumed, resumed from paused). A detail event fits any
 * stage not passed; a phase the profile does not have fits too (accepted
 * without a phase).
 */
export function fits(s: StageRun, phase: Phase | undefined): boolean {
  if (isPassed(s)) return false;
  if (!phase || s.phase === null || !profileHasPhase(s.type.profile, phase)) return true;
  if (phase === 'paused') return s.phase === 'started' || s.phase === 'resumed';
  if (phase === 'resumed') return s.phase === 'paused';
  return PHASE_RANK[phase] > PHASE_RANK[s.phase];
}

/** Pause and resume follow the machine strictly. */
export function fitsPause(s: StageRun, phase: 'paused' | 'resumed'): boolean {
  if (isPassed(s) || !profileHasPhase(s.type.profile, phase)) return false;
  return phase === 'paused' ? s.phase === 'started' || s.phase === 'resumed' : s.phase === 'paused';
}

export const finalPhase = (s: StageRun): Phase => FINAL_PHASE[s.type.profile];

/** Does the event type admit the stage type (point placement)? */
export function matchesType(type: EventType, stageType: StageType): boolean {
  const s = type.scope;
  if (s?.stageTypes) return s.stageTypes.includes(stageType.code);
  if (s?.kinds) return s.kinds.includes(stageType.kind);
  return stageType.kind === 'point';
}

class Route {
  private readonly segment: number[];

  constructor(readonly stages: readonly StageRun[]) {
    let k = 0;
    this.segment = stages.map((s) => {
      const own = k;
      if (s.type.endsSegment) k++;
      return own;
    });
  }

  current(cursor: number): number {
    if (cursor < 0) return 0;
    const s = this.stages[cursor] as StageRun;
    const own = this.segment[cursor] as number;
    return s.type.endsSegment && reached(s, 'completed') ? own + 1 : own;
  }

  range(segment: number): { from: number; to: number } | undefined {
    const from = this.segment.indexOf(segment);
    return from < 0 ? undefined : { from, to: this.segment.lastIndexOf(segment) };
  }
}

export interface Placed {
  readonly stage: StageRun;
  /** May the event change the phase of the stage? */
  readonly canSet: boolean;
  readonly note?: string;
}

export interface NotPlaced {
  readonly stage?: undefined;
  readonly note: string;
}

const REPEAT = 'Повтор: событие этого типа на этапе уже было';

export function place(run: TripRun, type: EventType): Placed | NotPlaced {
  const { stages, cursor } = run;
  if (stages.length === 0) return { note: 'У рейса нет маршрута' };
  const phase = type.setsPhase;
  const start = Math.max(cursor, 0);

  switch (type.placement) {
    case 'point':
      return placeAtPoint(run, type, phase, start);
    case 'here': {
      // The point at the cursor is passed: the vehicle is already on the next stage (the transit).
      let here = start;
      while (isPassed(stages[here] as StageRun) && here + 1 < stages.length) here++;
      return { stage: stages[here] as StageRun, canSet: phase !== undefined };
    }
    case 'road':
    default:
      return placeOnRoad(run, phase);
  }
}

function placeAtPoint(run: TripRun, type: EventType, phase: Phase | undefined, start: number): Placed | NotPlaced {
  const { stages, cursor, accepted } = run;
  const route = new Route(stages);

  // First a stage whose profile has the event's phase: the general "arrived" (all point types)
  // does not get stuck on a fast border crossing that has no arrival; else any that fits.
  const matchAt = (i: number, withPhase: boolean) => {
    const s = stages[i] as StageRun;
    return matchesType(type, s.type) && fits(s, phase) && (!withPhase || !phase || profileHasPhase(s.type.profile, phase));
  };
  const first = (from: number, to: number): number | undefined => {
    for (const withPhase of [true, false]) {
      for (let i = from; i <= to; i++) if (matchAt(i, withPhase)) return i;
    }
    return undefined;
  };

  // "Arrived" / "departed" again at the current point while nothing changed on it: a repeat
  // (driver and dispatcher about the same thing), not arrival at the next point.
  const current = stages[cursor];
  if (
    current &&
    (phase === 'arrived' || phase === 'departed') &&
    current.phase === phase &&
    matchesType(type, current.type) &&
    accepted.some((a) => a.code === type.code && a.stage === cursor)
  ) {
    return { stage: current, canSet: false, note: REPEAT };
  }

  let from = start;
  const segment = route.range(route.current(cursor));
  if (segment) {
    const found = first(Math.max(start, segment.from), segment.to);
    if (found !== undefined) return { stage: stages[found] as StageRun, canSet: true };

    // Such a stage is on the segment but already marked: a repeat or a conflict, not the next segment.
    const own: number[] = [];
    for (let i = segment.from; i <= segment.to; i++) if (matchesType(type, (stages[i] as StageRun).type)) own.push(i);
    if (own.length > 0) {
      const repeat = [...accepted].reverse().find((a) => a.code === type.code && own.includes(a.stage));
      return repeat
        ? { stage: stages[repeat.stage] as StageRun, canSet: false, note: REPEAT }
        : { note: `Этап «${stageTypesOf(type)}» на участке уже отмечен` };
    }

    // Unloading on a segment without an unloading: the handover at its end.
    const end = stages[segment.to] as StageRun;
    if (type.scope?.stageTypes?.includes(UNLOADING) && end.type.endsSegment && fits(end, phase)) {
      return { stage: end, canSet: true, note: 'Выгрузка участка — сдача' };
    }
    from = segment.to + 1;
  }

  // Not on the segment: the nearest one on the next segments (the handover was not marked).
  const next = first(from, stages.length - 1);
  if (next !== undefined) return { stage: stages[next] as StageRun, canSet: true };
  return { note: `Нет этапа «${stageTypesOf(type)}» впереди, где эта фаза ещё не отмечена` };
}

function placeOnRoad(run: TripRun, phase: Phase | undefined): Placed | NotPlaced {
  const { stages, cursor } = run;
  const current = stages[cursor];
  if (current) {
    if (current.type.kind === 'transit') return { stage: current, canSet: true };
    // At a point with the work not completed: road events (stop, rest, repair...) are a conflict,
    // the point has its own pause and the general "downtime"; "in transit" goes to the point without
    // a phase (heartbeat). Work completed: a road event means the vehicle drove off — the transit.
    if (current.phase !== null && !isPassed(current) && !reached(current, 'completed')) {
      return phase === 'started'
        ? { stage: current, canSet: false }
        : { note: `Событие транзита, а машина на точке «${current.type.code}»` };
    }
  }

  for (let i = cursor + 1; i < stages.length; i++) {
    const s = stages[i] as StageRun;
    if (s.type.kind === 'transit') return { stage: s, canSet: true };
    // A takeover after a completed handover: no transit between them, "in transit" is already the
    // receiving driver's; an unmarked takeover is closed by "everything before is passed".
    const prev = stages[i - 1];
    if (prev && prev.type.endsSegment && reached(prev, 'completed')) continue;
    // A point not reached yet: do not jump over it. No road to it — the current stage, no phase.
    if (s.phase === null) {
      const target = (cursor >= 0 ? stages[cursor] : s) as StageRun;
      return { stage: target, canSet: false, note: `Следующий этап — точка «${s.type.code}», отрезка пути до неё нет: фаза не меняется` };
    }
  }
  return { note: 'Нет транзита впереди' };
}

const stageTypesOf = (type: EventType) => (type.scope?.stageTypes ?? ['точка']).join(' / ');
