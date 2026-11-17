import { describe, expect, it } from 'vitest';
import { availableEvents, BASE_CATALOG, EXTENDED_CATALOG, stageTypeMap, validateCatalog } from '../src/index.js';
import { buildTrip, Journal, minutes, route } from './helpers.js';

describe('available events (what the user can do now)', () => {
  const trip = buildTrip(route('loading', 'unloading'), { catalog: EXTENDED_CATALOG });
  const codes = (j: Journal, role: 'driver' | 'dispatcher' = 'driver', stageId?: string) =>
    availableEvents(trip, j.events, EXTENDED_CATALOG, {
      role,
      userId: role === 'driver' ? 'driver-1' : 'disp-1',
      at: minutes(500),
      ...(stageId ? { stageId } : {}),
    });

  it('after arrival: start and finish of loading, waiting details, downtime', () => {
    const j = new Journal();
    j.driver('arrived');
    const list = codes(j).map((e) => e.typeCode);
    expect(list).toEqual(expect.arrayContaining(['loading_started', 'loaded', 'queue_joined', 'downtime', 'in_transit']));
    expect(list).not.toContain('unloaded');
    expect(list).not.toContain('rest'); // a road stop while the work at the point is not completed
  });

  it('shows departure with the unmet requirements instead of hiding it', () => {
    const j = new Journal();
    j.driver('arrived');
    j.driver('loaded');
    expect(codes(j).find((e) => e.typeCode === 'departed')?.requirementsUnmet).toEqual([
      'loading:loading_process_photos',
      'loading:seal_number',
      'loading:cmr_signed',
    ]);
  });

  it('the dispatcher sees skipping and waiving on a stage', () => {
    const list = codes(new Journal(), 'dispatcher', 'loading').map((e) => e.typeCode);
    expect(list).toEqual(expect.arrayContaining(['stage_skipped', 'requirement_waived']));
  });
});

describe('admin: stage type map and catalog check', () => {
  it('shows the events on each transition of a loading', () => {
    const map = stageTypeMap(BASE_CATALOG, 'loading');
    const at = (from: string | null, to: string) => map?.transitions.find((t) => t.from === from && t.to === to)?.events.map((e) => e.code);
    expect(at('arrived', 'started')).toEqual(['loading_started']);
    expect(at('started', 'completed')).toEqual(['loaded']);
    expect(at('completed', 'departed')).toEqual(['departed']);
    expect(at('started', 'paused')).toEqual(['downtime']);
  });

  it('marks transit start and end as automatic', () => {
    const map = stageTypeMap(BASE_CATALOG, 'transit');
    expect(map?.transitions.filter((t) => t.automatic).map((t) => `${t.from}→${t.to}`)).toEqual([
      'null→started',
      'started→completed',
      'resumed→completed',
    ]);
  });

  it('the base and the extended catalogs have no errors', () => {
    expect(validateCatalog(BASE_CATALOG).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateCatalog(EXTENDED_CATALOG).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('reports a requirement that refers to a missing event', () => {
    const broken = {
      ...BASE_CATALOG,
      requirementTemplates: { x: { code: 'x', title: 'x', kind: 'event' as const, eventType: 'nope', beforePhase: 'departed' as const } },
      requirementRules: [{ template: 'x', stageTypes: ['loading'] }],
    };
    expect(validateCatalog(broken).map((i) => i.code)).toContain('requirement_event_missing');
  });
});
