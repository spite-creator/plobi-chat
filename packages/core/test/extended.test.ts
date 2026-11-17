/**
 * What is planned with the driver app (EXTENDED_CATALOG): requirements on
 * stages, incidents, ferry events, dispatcher actions. The engine rules are
 * the same; these features run on top of them.
 */
import { describe, expect, it } from 'vitest';
import { EXTENDED_CATALOG, evaluateTrip, type StageRequirement, type TripInput, type TripResult } from '../src/index.js';
import { buildTrip, document, Journal, photos, route } from './helpers.js';

const catalog = EXTENDED_CATALOG;
const run = (trip: TripInput, j: Journal) => evaluateTrip(trip, j.events, catalog);
const stage = (r: TripResult, id: string) => r.stages.find((s) => s.id === id)!;
const result = (r: TripResult, eventId: string) => r.events.find((e) => e.eventId === eventId)!;

describe('requirements on a stage', () => {
  const trip = buildTrip(route('loading', 'unloading'), { catalog });

  it('block departure until fulfilled, and say what is missing', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    const dep = j.driver('departed');
    const r = run(trip, j);
    expect(result(r, dep.id).conflict).toEqual({
      reason: 'requirements_unmet',
      details: ['loading:loading_process_photos', 'loading:seal_number', 'loading:cmr_signed'],
    });
  });

  it('evidence collected on the way and on the departure itself counts', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loading_started');
    j.driver('photo_process', undefined, { attachments: photos('loading:loading_process_photos', 3) });
    j.driver('loaded');
    j.driver('seal_set', undefined, { values: { seal_number: 'S-1' }, attachments: photos('loading:seal_set', 1) });
    j.driver('departed', undefined, { attachments: document('loading:cmr_signed') });
    const r = run(trip, j);
    expect(r.events.every((e) => e.result === 'applied')).toBe(true);
    expect(stage(r, 'loading').requirements.every((q) => q.fulfilled && !q.violated)).toBe(true);
  });

  it('the dispatcher waives a requirement; offline the driver may pass with a recorded violation', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    for (const id of ['loading_process_photos', 'seal_number']) {
      j.dispatcher('requirement_waived', 'loading', { values: { requirementId: `loading:${id}`, reason: 'ok' } });
    }
    const dep = j.driver('departed', undefined, { acceptUnmet: true });
    const r = run(trip, j);
    expect(result(r, dep.id)).toMatchObject({ result: 'applied', requirementsUnmet: ['loading:cmr_signed'] });
    expect(stage(r, 'loading').requirements.find((q) => q.id === 'loading:cmr_signed')?.violated).toBe(true);
  });

  it('a stage passed by the rule (a later stage got a phase) keeps its unmet requirements as violated', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('arrived'); // repeat
    j.driver('unloading_started');
    const r = run(trip, j);
    expect(stage(r, 'loading')).toMatchObject({ state: 'passed', autoPassed: true });
    expect(stage(r, 'loading').requirements.every((q) => q.violated)).toBe(true);
  });

  it('"Acknowledged" blocks the start until confirmed, for the current revision', () => {
    const tiers: StageRequirement = {
      id: 'unloading:r0',
      source: 'manual',
      kind: 'acknowledgement',
      title: 'Не более 2 ярусов',
      beforePhase: 'started',
      revision: 2,
    };
    const t = { ...trip, stages: trip.stages.map((s) => (s.id === 'unloading' ? { ...s, requirements: [tiers] } : s)) };
    const j = new Journal();
    j.driver('acknowledged', 'unloading', { values: { requirementId: tiers.id, revision: 1 } }); // old revision
    j.driver('arrived');
    j.driver('loaded');
    j.driver('departed', undefined, { forced: true, values: { reason: 'test' } });
    j.driver('arrived');
    const early = j.driver('unloading_started');
    j.driver('acknowledged', 'unloading', { values: { requirementId: tiers.id, revision: 2 } });
    const ok = j.driver('unloading_started');
    const r = run(t, j);
    expect(result(r, early.id).conflict?.reason).toBe('requirements_unmet');
    expect(result(r, ok.id).result).toBe('applied');
  });
});

describe('incidents', () => {
  const trip = buildTrip(route('loading', 'unloading'));

  it('a breakdown pauses the work and blocks departure until resolved', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loading_started');
    const breakdown = j.driver('breakdown_reported', 'loading');
    const blocked = j.driver('departed');
    j.dispatcher('incident_resolved', undefined, { values: { incidentId: breakdown.id } });
    const r = run(trip, j);
    expect(result(r, blocked.id).conflict).toEqual({ reason: 'blocked_by_incident', details: [breakdown.id] });
    expect(stage(r, 'loading').phase).toBe('resumed');
  });
});

describe('ferry with the driver on board', () => {
  const trip = buildTrip(route('loading', 'ferry_embark', 'ferry_disembark', 'unloading'));

  it('boarding and "on board" start the ferry transit; "disembarked" ends it', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    j.driver('departed');
    j.driver('arrived');
    j.driver('checked_in');
    j.driver('boarding');
    j.driver('on_board');
    const sail = j.driver('ferry_departed');
    j.driver('disembarked');
    const r = run(trip, j);
    expect(r.events.every((e) => e.result === 'applied')).toBe(true);
    expect(result(r, sail.id).stageId).toBe('ferry_embark~ferry_disembark');
    expect(stage(r, 'ferry_embark~ferry_disembark')).toMatchObject({ mode: 'ferry', state: 'passed' });
    expect(stage(r, 'ferry_disembark').phase).toBe('arrived');
  });

  it('road-only events are out of scope on the ferry', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    j.driver('departed');
    j.driver('arrived');
    j.driver('boarding');
    j.driver('on_board');
    const fuel = j.driver('fuel_receipt', undefined, { values: { liters: 300 }, attachments: photos('x', 1, { field: 'receipt' }) });
    expect(result(run(trip, j), fuel.id).conflict).toEqual({ reason: 'out_of_scope', details: ['transport_mode'] });
  });
});

describe('roles and dispatcher actions', () => {
  const trip = buildTrip(route('loading', 'waypoint', 'unloading'));

  it('a driver cannot skip a stage; the dispatcher can, with a reason', () => {
    const j = new Journal();
    const byDriver = j.driver('stage_skipped', 'waypoint', { values: { reason: 'x' } });
    j.dispatcher('stage_skipped', 'waypoint', { values: { reason: 'закрыто' } });
    const r = run(trip, j);
    expect(result(r, byDriver.id).conflict).toEqual({ reason: 'out_of_scope', details: ['role'] });
    expect(stage(r, 'waypoint').state).toBe('skipped');
  });

  it('an observer cannot move phases', () => {
    const j = new Journal();
    const e = j.add('observer', 'arrived');
    expect(result(run(trip, j), e.id).conflict).toEqual({ reason: 'out_of_scope', details: ['role'] });
  });
});
