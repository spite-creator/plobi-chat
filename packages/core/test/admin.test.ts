import { describe, expect, it } from 'vitest';
import { availableEvents, BASE_CATALOG, stageTypeMap, validateCatalog } from '../src/index.js';
import { buildTrip, Journal, minutes } from './helpers.js';

describe('available events (buttons on a stage)', () => {
  const trip = buildTrip([{ id: 'load', typeCode: 'loading' }]);
  const codes = (j: Journal, role: 'driver' | 'dispatcher' = 'driver') =>
    availableEvents(trip, j.events, BASE_CATALOG, { role, userId: role === 'driver' ? 'driver-1' : 'disp-1', stageId: 'load', at: minutes(500) });

  it('after arrival the driver sees start, waiting details and departure', () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    const list = codes(j).map((e) => e.typeCode);
    expect(list).toEqual(expect.arrayContaining(['loading_started', 'work_started', 'queue_joined', 'at_dock', 'departed']));
    expect(list).not.toContain('loaded');
    expect(list).not.toContain('stage_skipped');
  });

  it('shows departure with the unmet checklist instead of hiding it', () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    j.driver('loading_started', 'load');
    j.driver('loaded', 'load');
    const departed = codes(j).find((e) => e.typeCode === 'departed');
    expect(departed?.requirementsUnmet).toEqual([
      'load:loading_process_photos',
      'load:seal_number',
      'load:seal_photo',
      'load:cmr_signed',
    ]);
  });

  it('the dispatcher sees skipping and waiving', () => {
    const list = codes(new Journal(), 'dispatcher').map((e) => e.typeCode);
    expect(list).toEqual(expect.arrayContaining(['stage_skipped', 'requirement_waived']));
  });
});

describe('admin: stage type map and catalog check', () => {
  it('shows events, roles and requirements on each transition of a loading', () => {
    const map = stageTypeMap(BASE_CATALOG, 'loading');
    const departure = map?.transitions.find((t) => t.from === 'completed' && t.to === 'departed');
    expect(departure?.events.map((e) => e.code)).toEqual(['departed']);
    expect(departure?.requirements.map((r) => r.code)).toEqual(
      expect.arrayContaining(['loading_process_photos', 'seal_number', 'seal_photo', 'cmr_signed', 'reefer_temperature']),
    );
    const start = map?.transitions.find((t) => t.from === 'arrived' && t.to === 'started');
    expect(start?.events.map((e) => e.code)).toEqual(['work_started', 'loading_started']);
    const atArrival = map?.detailEvents.find((d) => d.phase === 'arrived')?.events;
    expect(atArrival).toEqual(expect.arrayContaining(['queue_joined', 'at_dock', 'eta_update']));
    expect(atArrival).not.toContain('docs_received');
  });

  it('marks transit start and end as automatic', () => {
    const map = stageTypeMap(BASE_CATALOG, 'transit');
    expect(map?.transitions.filter((t) => t.automatic).map((t) => `${t.from}→${t.to}`)).toEqual([
      'null→started',
      'started→completed',
      'resumed→completed',
    ]);
  });

  it('the base catalog has no issues', () => {
    expect(validateCatalog(BASE_CATALOG)).toEqual([]);
  });

  it('reports a requirement that refers to a missing event', () => {
    const broken = {
      ...BASE_CATALOG,
      requirementTemplates: {
        ...BASE_CATALOG.requirementTemplates,
        x: { code: 'x', title: { ru: 'x' }, kind: 'event' as const, eventType: 'nope', beforePhase: 'departed' as const, strictness: 'block' as const, waivable: false },
      },
      requirementRules: [...BASE_CATALOG.requirementRules, { template: 'x', stageTypes: ['loading'] }],
    };
    expect(validateCatalog(broken).map((i) => i.code)).toContain('requirement_event_missing');
  });
});
