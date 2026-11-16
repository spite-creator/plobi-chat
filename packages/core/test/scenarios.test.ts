import { describe, expect, it } from 'vitest';
import { BASE_CATALOG, evaluateTrip, type TripResult } from '../src/index.js';
import { buildTrip, completeLoadingEvidence, document, Journal, photos } from './helpers.js';

const stage = (r: TripResult, id: string) => {
  const s = r.stages.find((x) => x.id === id);
  if (!s) throw new Error(`no stage ${id}`);
  return s;
};
const conflicts = (r: TripResult) => r.events.filter((e) => e.result === 'conflict');

describe('regular trip: loading → road → unloading', () => {
  const trip = buildTrip([
    { id: 'load', typeCode: 'loading' },
    { id: 'unload', typeCode: 'unloading' },
  ]);

  function run() {
    const j = new Journal();
    j.driver('trip_accepted');
    const arrived = j.driver('arrived', 'load');
    j.driver('queue_joined', 'load');
    const started = j.driver('loading_started', 'load');
    completeLoadingEvidence(j, 'load');
    const departed = j.driver('departed', 'load');
    const rest = j.driver('rest_started', 'load~unload', { values: { reason: 'daily' } });
    const resume = j.driver('moving_resumed', 'load~unload');
    const arrivedUnload = j.driver('arrived', 'unload', { attachments: photos('unload:unloading_cargo_before', 1) });
    j.driver('unloading_started', 'unload');
    j.driver('photo_process', 'unload', { attachments: photos('unload:unloading_process_photos', 3) });
    j.driver('unloaded', 'unload');
    j.driver('docs_received', 'unload', { attachments: document('unload:proof_of_delivery') });
    j.driver('departed', 'unload');
    return { j, arrived, started, departed, rest, resume, arrivedUnload };
  }

  it('applies every event without conflicts and finishes the trip', () => {
    const { j } = run();
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(conflicts(r)).toEqual([]);
    expect(r.state).toBe('finished');
    expect(r.stages.map((s) => [s.id, s.state, s.phase])).toEqual([
      ['load', 'passed', 'departed'],
      ['load~unload', 'passed', 'completed'],
      ['unload', 'passed', 'departed'],
    ]);
  });

  it('records milestones and pauses so durations can be computed', () => {
    const { j, arrived, started, departed, rest, resume, arrivedUnload } = run();
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    const load = stage(r, 'load');
    expect(load.arrivedAt).toBe(arrived.occurredAt);
    expect(load.startedAt).toBe(started.occurredAt);
    expect(load.departedAt).toBe(departed.occurredAt);
    expect(load.completedAt).toBeDefined();

    const road = stage(r, 'load~unload');
    expect(road.startedAt).toBe(departed.occurredAt); // same "departed" opens the transit
    expect(road.completedAt).toBe(arrivedUnload.occurredAt); // same "arrived" closes it
    expect(road.pauses).toEqual([{ from: rest.occurredAt, to: resume.occurredAt, reason: 'daily' }]);
    expect(road.pausedMs).toBe(10 * 60_000);
  });

  it('reports the boundary effects on the events that caused them', () => {
    const { j, departed, arrivedUnload } = run();
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === departed.id)?.effects).toEqual(['stage:load~unload started']);
    expect(r.events.find((e) => e.eventId === arrivedUnload.id)?.effects).toEqual(['stage:load~unload completed']);
  });

  it('closes after the dispatcher confirms, then locks the journal', () => {
    const { j } = run();
    j.dispatcher('trip_closed');
    const late = j.driver('eta_update', 'unload', { values: { eta: '2026-11-21T10:00:00Z' } });
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(r.state).toBe('closed');
    expect(r.events.find((e) => e.eventId === late.id)?.conflict?.reason).toBe('trip_locked');
  });

  it('gives the same result whatever order events arrive in (offline sync)', () => {
    const { j } = run();
    const shuffled = [...j.events].reverse();
    expect(evaluateTrip(trip, shuffled, BASE_CATALOG)).toEqual(evaluateTrip(trip, j.events, BASE_CATALOG));
  });

  it('ignores a duplicate retry of the same event', () => {
    const { j } = run();
    const r = evaluateTrip(trip, [...j.events, ...j.events], BASE_CATALOG);
    expect(r.events).toHaveLength(j.events.length);
  });
});

describe('order of stages', () => {
  const trip = buildTrip([
    { id: 'load', typeCode: 'loading' },
    { id: 'unload', typeCode: 'unloading' },
  ]);

  it('rejects arrival at the next point while the previous point is not left', () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    const jump = j.driver('arrived', 'unload');
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === jump.id)?.conflict).toEqual({ reason: 'order_violation', details: ['load'] });
    expect(r.currentStageId).toBe('load');
  });

  it('rejects a phase that the profile does not allow from the current one', () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    const loaded = j.driver('loaded', 'load');
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === loaded.id)?.conflict).toEqual({
      reason: 'invalid_transition',
      details: ['arrived → completed'],
    });
  });

  it('lets the dispatcher skip a point; the transit after it is skipped too', () => {
    const t = buildTrip([
      { id: 'a', typeCode: 'waypoint' },
      { id: 'b', typeCode: 'depot' },
      { id: 'c', typeCode: 'waypoint' },
    ]);
    const j = new Journal();
    j.driver('arrived', 'a');
    j.driver('departed', 'a');
    j.dispatcher('stage_skipped', 'b', { values: { reason: 'closed station' } });
    j.driver('arrived', 'c');
    const r = evaluateTrip(t, j.events, BASE_CATALOG);
    expect(conflicts(r)).toEqual([]);
    expect(r.stages.map((s) => [s.id, s.state])).toEqual([
      ['a', 'passed'],
      ['a~b', 'passed'],
      ['b', 'skipped'],
      ['b~c', 'skipped'],
      ['c', 'in_progress'],
    ]);
  });

  it('allows skipping a passed stage, and keeps a late driver event as a conflict', () => {
    const t = buildTrip([{ id: 'a', typeCode: 'waypoint' }]);
    const j = new Journal();
    j.driver('arrived', 'a');
    j.dispatcher('stage_skipped', 'a', { values: { reason: 'wrong stage' } });
    const late = j.driver('departed', 'a');
    const r = evaluateTrip(t, j.events, BASE_CATALOG);
    expect(stage(r, 'a').state).toBe('skipped');
    expect(r.events.find((e) => e.eventId === late.id)?.conflict?.reason).toBe('stage_closed');
  });
});

describe('requirements before a phase', () => {
  const trip = buildTrip([{ id: 'load', typeCode: 'loading' }]);
  const upToLoaded = () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    j.driver('loading_started', 'load');
    j.driver('loaded', 'load');
    return j;
  };

  it('blocks departure and lists what is missing', () => {
    const j = upToLoaded();
    const dep = j.driver('departed', 'load');
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === dep.id)?.conflict).toEqual({
      reason: 'requirements_unmet',
      details: ['load:loading_process_photos', 'load:seal_number', 'load:seal_photo', 'load:cmr_signed'],
    });
    expect(stage(r, 'load').phase).toBe('completed');
  });

  it('counts evidence attached to the transition event itself (checklist)', () => {
    const j = upToLoaded();
    j.driver('photo_process', 'load', { attachments: photos('load:loading_process_photos', 3) });
    j.driver('seal_set', 'load', { values: { seal_number: 'S1' }, attachments: photos('load:seal_photo', 1) });
    j.driver('departed', 'load', { attachments: document('load:cmr_signed') });
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(conflicts(r)).toEqual([]);
    expect(stage(r, 'load').requirements.every((x) => x.fulfilled && !x.violated)).toBe(true);
  });

  it('does not count process photos taken before work started, or from the gallery', () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    j.driver('photo_process', 'load', { attachments: photos('load:loading_process_photos', 3) }); // too early
    j.driver('loading_started', 'load');
    j.driver('photo_process', 'load', { attachments: photos('load:loading_process_photos', 3, { source: 'gallery' }) });
    j.driver('photo_process', 'load', { attachments: photos('load:loading_process_photos', 2) });
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    const req = stage(r, 'load').requirements.find((x) => x.id === 'load:loading_process_photos');
    expect(req).toMatchObject({ have: 2, need: 3, fulfilled: false });
  });

  it('lets the driver pass offline with a violation that is recorded', () => {
    const j = upToLoaded();
    const dep = j.driver('departed', 'load', { acceptUnmet: true });
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    const result = r.events.find((e) => e.eventId === dep.id);
    expect(result?.result).toBe('applied');
    expect(result?.requirementsUnmet).toHaveLength(4);
    expect(stage(r, 'load').requirements.every((x) => x.violated)).toBe(true);
  });

  it('a waived requirement no longer blocks', () => {
    const j = upToLoaded();
    for (const id of ['loading_process_photos', 'seal_number', 'seal_photo', 'cmr_signed']) {
      j.dispatcher('requirement_waived', 'load', { values: { requirementId: `load:${id}`, reason: 'client agreed' } });
    }
    j.driver('departed', 'load');
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(conflicts(r)).toEqual([]);
    expect(stage(r, 'load').requirements.every((x) => x.waived && x.fulfilled)).toBe(true);
  });

  it('a warn-level requirement lets the phase through and is reported', () => {
    const t = buildTrip([{ id: 'unload', typeCode: 'unloading' }]);
    const j = new Journal();
    j.driver('arrived', 'unload');
    const start = j.driver('unloading_started', 'unload');
    const r = evaluateTrip(t, j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === start.id)).toMatchObject({
      result: 'applied',
      warnings: ['unload:unloading_cargo_before'],
    });
  });

  it('tag rules add requirements: #reefer needs a temperature reading', () => {
    const t = buildTrip([{ id: 'load', typeCode: 'loading' }], { tags: ['reefer'] });
    expect(t.stages[0]?.requirements?.map((x) => x.template)).toContain('reefer_temperature');
  });
});

describe('ferry with the driver on board (embark → disembark)', () => {
  const trip = buildTrip([
    { id: 'port1', typeCode: 'embark' },
    { id: 'port2', typeCode: 'disembark' },
    { id: 'unload', typeCode: 'unloading' },
  ]);

  it('inserts one transit type; the one between embark and disembark goes by ferry', () => {
    expect(trip.stages.map((s) => [s.typeCode, s.mode])).toEqual([
      ['embark', undefined],
      ['transit', 'ferry'],
      ['disembark', undefined],
      ['transit', 'road'],
      ['unloading', undefined],
    ]);
  });

  it('boarding → on board starts the ferry; disembarking ends it', () => {
    const j = new Journal();
    j.driver('arrived', 'port1');
    j.driver('checked_in', 'port1', { values: { booking: 'B-77' } });
    j.driver('boarding', 'port1', { attachments: photos('port1:ferry_ticket', 1) });
    j.driver('on_board', 'port1');
    j.driver('carrier_departed', 'port1~port2');
    j.driver('disembarked', 'port2');
    j.driver('departed', 'port2');
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(conflicts(r)).toEqual([]);
    expect(r.stages.slice(0, 4).map((s) => [s.id, s.state, s.phase, s.mode])).toEqual([
      ['port1', 'passed', 'departed', undefined],
      ['port1~port2', 'passed', 'completed', 'ferry'],
      ['port2', 'passed', 'departed', undefined],
      ['port2~unload', 'in_progress', 'started', 'road'],
    ]);
  });

  it('road events are out of scope on the ferry', () => {
    const j = new Journal();
    j.driver('arrived', 'port1');
    j.driver('boarding', 'port1', { attachments: photos('port1:ferry_ticket', 1) });
    j.driver('on_board', 'port1');
    const rest = j.driver('rest_started', 'port1~port2', { values: { reason: 'short' } });
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === rest.id)?.conflict).toEqual({ reason: 'out_of_scope', details: ['transport_mode'] });
  });
});

describe('fast border crossing (border_open)', () => {
  const trip = buildTrip([
    { id: 'load', typeCode: 'waypoint' },
    { id: 'pl-de', typeCode: 'border_open' },
    { id: 'unload', typeCode: 'waypoint' },
  ]);

  it('one button "passed"', () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    j.driver('departed', 'load');
    j.driver('border_passed', 'pl-de');
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(conflicts(r)).toEqual([]);
    expect(stage(r, 'pl-de')).toMatchObject({ state: 'passed', phase: 'departed' });
    expect(stage(r, 'pl-de').autoPassed).toBeUndefined();
    expect(r.currentStageId).toBe('pl-de~unload');
  });

  it('closes by itself when the driver arrives further without pressing it', () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    j.driver('departed', 'load');
    const arrival = j.driver('arrived', 'unload');
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(conflicts(r)).toEqual([]);
    expect(r.stages.map((s) => [s.id, s.state])).toEqual([
      ['load', 'passed'],
      ['load~pl-de', 'passed'],
      ['pl-de', 'passed'],
      ['pl-de~unload', 'passed'],
      ['unload', 'in_progress'],
    ]);
    expect(stage(r, 'pl-de').autoPassed).toBe(true);
    expect(r.events.find((e) => e.eventId === arrival.id)?.effects).toEqual([
      'stage:load~pl-de completed',
      'stage:pl-de passed automatically',
      'stage:pl-de~unload completed',
    ]);
  });

  it('a regular border post does not close by itself', () => {
    const t = buildTrip([
      { id: 'a', typeCode: 'waypoint' },
      { id: 'exit', typeCode: 'border_exit' },
      { id: 'b', typeCode: 'waypoint' },
    ]);
    const j = new Journal();
    j.driver('arrived', 'a');
    j.driver('departed', 'a');
    const jump = j.driver('arrived', 'b');
    const r = evaluateTrip(t, j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === jump.id)?.conflict).toEqual({ reason: 'order_violation', details: ['exit'] });
  });
});

describe('handover → takeover: the responsible person changes', () => {
  // Driver 1 hands the cargo over at the warehouse; driver 2 takes it over and leads on.
  const trip = {
    ...buildTrip([
      { id: 'hand', typeCode: 'handover' },
      { id: 'take', typeCode: 'takeover' },
      { id: 'unload', typeCode: 'unloading' },
    ]),
  };
  const stages = trip.stages.map((s) => (s.id === 'take' ? { ...s, assigneeId: 'driver-2' } : s));
  const twoDrivers = { ...trip, stages };
  const asDriver2 = { authorId: 'driver-2' };

  it('has no transit between handover and takeover', () => {
    expect(twoDrivers.stages.map((s) => s.typeCode)).toEqual(['handover', 'takeover', 'transit', 'unloading']);
  });

  it('the receiving driver leads the rest of the trip', () => {
    const j = new Journal();
    j.driver('arrived', 'hand');
    j.driver('handover_started', 'hand');
    j.driver('photo_process', 'hand', { attachments: photos('hand:transfer_photos', 4) });
    j.driver('handed_over', 'hand', { values: { transferred: ['cargo', 'trailer'], to: 'Склад Северный' } });
    j.driver('departed', 'hand', { attachments: document('hand:transfer_act') });

    // Driver 1 cannot take the cargo over for driver 2.
    const wrong = j.driver('arrived', 'take');
    j.add('driver', 'arrived', 'take', asDriver2);
    const r = evaluateTrip(twoDrivers, j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === wrong.id)?.conflict).toEqual({ reason: 'out_of_scope', details: ['assignee'] });
    expect(stage(r, 'hand').assigneeId).toBe('driver-1');
    expect(r.stages.slice(1).map((s) => s.assigneeId)).toEqual(['driver-2', 'driver-2', 'driver-2']);
    expect(stage(r, 'take').phase).toBe('arrived');
  });
});

describe('customs with detention', () => {
  const trip = buildTrip([{ id: 'cus', typeCode: 'export_clearance' }]);

  it('detained / lifted are pause / resume with the reason kept', () => {
    const j = new Journal();
    j.driver('arrived', 'cus');
    j.driver('docs_submitted', 'cus');
    const det = j.driver('detained', 'cus', { values: { reason: 'inspection' } });
    const lift = j.driver('detention_lifted', 'cus');
    j.driver('released', 'cus');
    j.driver('departed', 'cus', { attachments: document('cus:customs_release_docs') });
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(conflicts(r)).toEqual([]);
    expect(stage(r, 'cus').pauses).toEqual([{ from: det.occurredAt, to: lift.occurredAt, reason: 'inspection' }]);
  });

  it('customs cannot be left without the work being done', () => {
    const j = new Journal();
    j.driver('arrived', 'cus');
    const dep = j.driver('departed', 'cus', { values: { reason: 'tired' } });
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === dep.id)?.conflict?.reason).toBe('invalid_transition');
  });

  it('a loading point can be left without loading, but only with a reason', () => {
    const t = buildTrip([{ id: 'load', typeCode: 'loading' }]);
    const j = new Journal();
    j.driver('arrived', 'load');
    const noReason = j.driver('departed', 'load');
    j.driver('departed', 'load', { values: { reason: 'cargo not ready' } });
    const r = evaluateTrip(t, j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === noReason.id)?.conflict?.reason).toBe('reason_required');
    expect(stage(r, 'load').state).toBe('passed');
    expect(stage(r, 'load').requirements.every((x) => x.notApplicable && !x.violated)).toBe(true);
  });
});

describe('incidents', () => {
  const trip = buildTrip([{ id: 'load', typeCode: 'loading' }]);

  it('a breakdown pauses work and blocks departure until resolved', () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    j.driver('loading_started', 'load');
    const breakdown = j.driver('breakdown_reported', 'load');
    j.dispatcher('incident_acknowledged', undefined, { values: { incidentId: breakdown.id } });
    let r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(stage(r, 'load').phase).toBe('paused');
    expect(r.incidents[0]).toMatchObject({ state: 'acknowledged', blocksProgress: true });

    j.dispatcher('incident_resolved', undefined, { values: { incidentId: breakdown.id } });
    r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(stage(r, 'load').phase).toBe('resumed');
    expect(stage(r, 'load').pauses[0]?.incidentId).toBe(breakdown.id);
  });

  it('departure is refused while a blocking incident is open', () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    const breakdown = j.driver('breakdown_reported', 'load');
    const dep = j.driver('departed', 'load', { values: { reason: 'leaving' } });
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === dep.id)?.conflict).toEqual({
      reason: 'blocked_by_incident',
      details: [breakdown.id],
    });
  });
});

describe('scope labels and roles', () => {
  const trip = buildTrip([{ id: 'load', typeCode: 'loading' }]);

  it('a driver cannot skip a stage', () => {
    const j = new Journal();
    const skip = j.driver('stage_skipped', 'load', { values: { reason: 'x' } });
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === skip.id)?.conflict).toEqual({ reason: 'out_of_scope', details: ['role'] });
  });

  it('a dispatcher may act for the driver, only with a reason', () => {
    const j = new Journal();
    const noReason = j.dispatcher('arrived', 'load', { forced: true });
    j.dispatcher('arrived', 'load', { forced: true, values: { reason: 'driver phone is dead' } });
    const r = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === noReason.id)?.conflict?.reason).toBe('reason_required');
    expect(stage(r, 'load').phase).toBe('arrived');
  });

  it('a temperature reading exists only on #reefer trips', () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    const temp = j.driver('temp_reading', 'load', { values: { temperature: 4 } });
    const plain = evaluateTrip(trip, j.events, BASE_CATALOG);
    expect(plain.events.find((e) => e.eventId === temp.id)?.conflict).toEqual({
      reason: 'out_of_scope',
      details: ['tags_required'],
    });
    const reefer = evaluateTrip({ ...trip, tags: ['reefer'] }, j.events, BASE_CATALOG);
    expect(reefer.events.find((e) => e.eventId === temp.id)?.result).toBe('applied');
  });

  it('event forms are validated: conditional field becomes required', () => {
    const t = buildTrip([
      { id: 'a', typeCode: 'waypoint' },
      { id: 'b', typeCode: 'waypoint' },
    ]);
    const j = new Journal();
    j.driver('arrived', 'a');
    j.driver('departed', 'a');
    const stop = j.driver('stopped', 'a~b', { values: { reason: 'other' } });
    const r = evaluateTrip(t, j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === stop.id)?.conflict).toEqual({ reason: 'invalid_values', details: ['comment'] });
  });
});
