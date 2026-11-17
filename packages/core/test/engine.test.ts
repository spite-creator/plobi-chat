/**
 * Engine rules for events from an external system or the driver, base catalog
 * (docs/overview.md, docs/base-catalog.md). Events do not name their stage:
 * the engine places them.
 */
import { describe, expect, it } from 'vitest';
import { BASE_CATALOG, evaluateTrip, type TripInput, type TripResult } from '../src/index.js';
import { buildTrip, Journal, route } from './helpers.js';

const run = (trip: TripInput, j: Journal) => evaluateTrip(trip, j.events, BASE_CATALOG);
const stage = (r: TripResult, id: string) => r.stages.find((s) => s.id === id)!;
const result = (r: TripResult, eventId: string) => r.events.find((e) => e.eventId === eventId)!;
const phases = (r: TripResult) => r.stages.map((s) => `${s.id}:${s.phase ?? '-'}`);

describe('a regular trip, events placed by the engine', () => {
  const trip = buildTrip(route('loading', 'export_clearance', 'unloading'));

  it('places every event, opens and closes transits, finishes the trip', () => {
    const j = new Journal();
    const arrived = j.driver('arrived');
    j.driver('loading_started');
    j.driver('loaded');
    j.driver('documents_received');
    const departed = j.driver('departed');
    j.driver('in_transit');
    const atCustoms = j.driver('arrived');
    j.driver('export_clearance_started');
    j.driver('export_cleared');
    j.driver('departed');
    j.driver('arrived');
    j.driver('unloading_started');
    const unloaded = j.driver('unloaded');
    const r = run(trip, j);

    expect(r.events.every((e) => e.result === 'applied')).toBe(true);
    expect(result(r, arrived.id).stageId).toBe('loading');
    expect(result(r, atCustoms.id).stageId).toBe('export_clearance');
    expect(result(r, departed.id).effects).toEqual(['stage:loading departed', 'stage:loading~export_clearance started (auto)']);
    expect(result(r, atCustoms.id).effects).toEqual(['stage:loading~export_clearance completed (auto)', 'stage:export_clearance arrived']);
    // The last stage completed is also departed: no departure comes after the last unloading.
    expect(result(r, unloaded.id).effects).toEqual(['stage:unloading completed', 'stage:unloading departed (auto)']);
    expect(r.state).toBe('finished');
  });

  it('a phase on a stage passes everything before it', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loading_started');
    const atUnloading = j.driver('unloading_started'); // loading, customs and transits were never closed
    const r = run(trip, j);
    expect(result(r, atUnloading.id).stageId).toBe('unloading');
    expect(phases(r)).toEqual([
      'loading:departed',
      'loading~export_clearance:completed',
      'export_clearance:departed',
      'export_clearance~unloading:completed',
      'unloading:started',
    ]);
    expect(r.stages.slice(0, 4).every((s) => s.autoPassed)).toBe(true);
  });

  it('phases only go forward, but may jump: "loaded" right after "arrived" is accepted', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    expect(stage(run(trip, j), 'loading').phase).toBe('completed');
  });

  it('the same "arrived" again at the current point is a repeat, not the next point', () => {
    const j = new Journal();
    j.driver('arrived');
    const again = j.add('dispatcher', 'arrived');
    const r = run(trip, j);
    expect(result(r, again.id)).toMatchObject({ result: 'applied', stageId: 'loading', note: expect.stringContaining('Повтор') });
    expect(stage(r, 'export_clearance').phase).toBeNull();
  });

  it('an event for a stage already passed on the segment is a conflict, if it was never sent', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    j.driver('departed');
    j.driver('arrived'); // at export clearance
    j.driver('export_cleared');
    const late = j.driver('loading_started'); // loading is behind
    const r = run(trip, j);
    expect(result(r, late.id).conflict).toEqual({ reason: 'not_placed', details: ['Этап «loading» на участке уже отмечен'] });
  });

  it('the result does not depend on the order events arrive in', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loading_started');
    j.driver('loaded');
    j.driver('departed');
    j.driver('rest');
    j.driver('in_transit');
    j.driver('arrived');
    expect(evaluateTrip(trip, [...j.events].reverse(), BASE_CATALOG)).toEqual(run(trip, j));
  });

  it('a cancelled event is placed for display but changes nothing', () => {
    const j = new Journal();
    const arrived = j.driver('arrived', undefined, { cancelled: true });
    const r = run(trip, j);
    expect(result(r, arrived.id)).toMatchObject({ result: 'applied', stageId: 'loading', cancelled: true, effects: [] });
    expect(stage(r, 'loading').phase).toBeNull();
  });
});

describe('borders', () => {
  const trip = buildTrip(route('loading', 'border_exit', 'border_open', 'border_entry', 'unloading'));

  it('a fast crossing has no "arrived": arrival goes to the next point and the crossing closes itself', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    j.driver('departed');
    j.driver('arrived'); // border exit
    j.driver('border_control_started');
    j.driver('border_crossed');
    const next = j.driver('arrived'); // not the fast crossing: the border entry
    const r = run(trip, j);
    expect(result(r, next.id).stageId).toBe('border_entry');
    expect(stage(r, 'border_open')).toMatchObject({ state: 'passed', phase: 'departed', autoPassed: true });
  });

  it('"crossed the border" marks the nearest unmarked post', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    j.driver('departed');
    const a = j.driver('border_crossed');
    j.driver('in_transit');
    const b = j.driver('border_crossed');
    const r = run(trip, j);
    expect([result(r, a.id).stageId, result(r, b.id).stageId]).toEqual(['border_exit', 'border_open']);
  });

  it('the same "crossed" again right away is a repeat on the same post', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    j.driver('departed');
    j.driver('border_crossed');
    const again = j.driver('border_crossed');
    expect(result(run(trip, j), again.id)).toMatchObject({ stageId: 'border_exit', note: expect.stringContaining('Повтор') });
  });

  it('leaving a point right after arrival, without the work, needs a reason; customs does not allow it', () => {
    const j = new Journal();
    j.driver('arrived');
    const bare = j.driver('departed');
    j.driver('departed', undefined, { values: { reason: 'груз не готов' } });
    const r = run(trip, j);
    expect(result(r, bare.id).conflict?.reason).toBe('reason_required');
    expect(stage(r, 'loading').phase).toBe('departed');
  });
});

describe('stops: the event is the reason of the pause', () => {
  const trip = buildTrip(route('loading', 'unloading'));
  const road = 'loading~unloading';
  const onTheRoad = () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    j.driver('departed');
    return j;
  };

  it('a stop on the road pauses the transit; "in transit" resumes it', () => {
    const j = onTheRoad();
    const rest = j.driver('rest');
    const go = j.driver('in_transit');
    const r = run(trip, j);
    expect(result(r, rest.id).effects).toEqual([`stage:${road} paused`]);
    expect(result(r, go.id).effects).toEqual([`stage:${road} resumed`]);
    expect(stage(r, road).pauses).toEqual([{ from: rest.occurredAt, to: go.occurredAt, reason: 'rest' }]);
  });

  it('a second stop during a pause changes the reason and keeps the default fault', () => {
    const j = onTheRoad();
    j.driver('rest');
    const repair = j.driver('repair');
    const r = run(trip, j);
    expect(result(r, repair.id).effects).toEqual([]);
    expect(stage(r, road).pauses).toEqual([expect.objectContaining({ reason: 'repair', fault: 'carrier' })]);
  });

  it('a fault sent with the stop wins over the default', () => {
    const j = onTheRoad();
    j.driver('bad_weather', undefined, { values: { fault: 'customer' } });
    expect(stage(run(trip, j), road).pauses[0]?.fault).toBe('customer');
  });

  it('road stops while the work at a point is not completed are a conflict; "downtime" pauses the work', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loading_started');
    const rest = j.driver('rest');
    const downtime = j.driver('downtime');
    const r = run(trip, j);
    expect(result(r, rest.id).conflict?.details).toEqual(['Событие транзита, а машина на точке «loading»']);
    expect(result(r, downtime.id).effects).toEqual(['stage:loading paused']);
  });

  it('downtime while waiting for the work to start stays a detail: waiting is counted by the machine', () => {
    const j = new Journal();
    j.driver('arrived');
    const downtime = j.driver('downtime');
    const r = run(trip, j);
    expect(result(r, downtime.id)).toMatchObject({ result: 'applied', stageId: 'loading', effects: [] });
    expect(stage(r, 'loading').phase).toBe('arrived');
  });

  it('a stop right after the work is completed means the vehicle drove off and stopped', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    const rest = j.driver('rest'); // no "departed" came
    const r = run(trip, j);
    expect(result(r, rest.id).stageId).toBe(road);
    expect(phases(r)).toEqual(['loading:departed', `${road}:paused`, 'unloading:-']);
  });

  it('"in transit" at a point while working is a heartbeat: accepted, no phase', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loading_started');
    const beat = j.driver('in_transit');
    const r = run(trip, j);
    expect(result(r, beat.id)).toMatchObject({ result: 'applied', stageId: 'loading', effects: [] });
  });
});

describe('handover and takeover: segments of the route', () => {
  const points = route('loading', 'handover', 'takeover', 'unloading');
  const trip = buildTrip(points);

  it('there is no transit between handover and takeover', () => {
    expect(trip.stages.map((s) => s.typeCode)).toEqual(['loading', 'transit', 'handover', 'takeover', 'transit', 'unloading']);
  });

  it('after the handover is completed, "arrived" belongs to the takeover', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    j.driver('departed');
    j.driver('arrived');
    j.driver('handover_started');
    j.driver('handed_over');
    const next = j.driver('arrived');
    expect(result(run(trip, j), next.id).stageId).toBe('takeover');
  });

  it('once the cargo is handed over, the current segment is the next one: even "departed" goes there', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    j.driver('departed');
    j.driver('arrived');
    j.driver('handed_over');
    const departed = j.driver('departed');
    expect(result(run(trip, j), departed.id).stageId).toBe('takeover');
  });

  it('unloading on a segment without an unloading goes to the handover that ends it', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    j.driver('departed');
    j.driver('arrived');
    const unloaded = j.driver('unloaded');
    const r = run(trip, j);
    expect(result(r, unloaded.id)).toMatchObject({ stageId: 'handover', note: 'Выгрузка участка — сдача' });
    expect(stage(r, 'handover').phase).toBe('completed');
  });

  it('the receiving driver leads on; the first one cannot act for them', () => {
    const twoDrivers = { ...trip, stages: trip.stages.map((s) => (s.id === 'takeover' ? { ...s, assigneeId: 'driver-2' } : s)) };
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    j.driver('departed');
    j.driver('arrived');
    j.driver('handed_over');
    const wrong = j.driver('arrived');
    j.add('driver', 'arrived', undefined, { authorId: 'driver-2' });
    const r = evaluateTrip(twoDrivers, j.events, BASE_CATALOG);
    expect(result(r, wrong.id).conflict).toEqual({ reason: 'out_of_scope', details: ['assignee'] });
    expect(stage(r, 'takeover').phase).toBe('arrived');
    expect(r.stages.slice(3).map((s) => s.assigneeId)).toEqual(['driver-2', 'driver-2', 'driver-2']);
  });
});

describe('ferry transit', () => {
  it('the transit between ferry embark and disembark goes by ferry', () => {
    const trip = buildTrip(route('loading', 'ferry_embark', 'ferry_disembark', 'unloading'));
    expect(trip.stages.map((s) => s.mode ?? s.typeCode)).toEqual([
      'loading',
      'road',
      'ferry_embark',
      'ferry',
      'ferry_disembark',
      'road',
      'unloading',
    ]);
  });
});
