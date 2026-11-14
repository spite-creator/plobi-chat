import { describe, expect, it } from 'vitest';
import { BASE_CATALOG, evaluateTrip, materializeRequirements, type StageRequirement, type TripInput } from '../src/index.js';
import { Journal } from './helpers.js';

/** Requirements put on the stage together with the trip (API or dispatcher). */
const callAshot: StageRequirement = {
  id: 'load:m0',
  source: 'manual',
  kind: 'info',
  title: 'Позвони Ашоту, он откроет ворота',
  contact: { name: 'Ашот', phone: '+7 900 000-00-00' },
  showAt: 'arrived',
};
const noTiers: StageRequirement = {
  id: 'load:m1',
  source: 'manual',
  kind: 'acknowledgement',
  title: 'Не грузить выше 2 ярусов',
  showAt: 'arrived',
  beforePhase: 'started',
};
const strapsPhoto: StageRequirement = {
  id: 'load:m2',
  source: 'manual',
  kind: 'photo',
  title: 'Фото крепления ремнями',
  min: 2,
  beforePhase: 'departed',
};

const tripWith = (requirements: StageRequirement[]): TripInput => ({
  id: 't',
  driverId: 'driver-1',
  stages: [{ id: 'load', typeCode: 'loading', requirements }],
});
const ack = (j: Journal, req: StageRequirement, revision = 1) =>
  j.driver('acknowledged', 'load', { values: { requirementId: req.id, revision } });

describe('one list of requirements per stage', () => {
  it('information is shown from its phase and never blocks', () => {
    const before = evaluateTrip(tripWith([callAshot]), [], BASE_CATALOG).stages[0]?.requirements[0];
    expect(before).toMatchObject({ kind: 'info', visible: false, fulfilled: true });

    const j = new Journal();
    j.driver('arrived', 'load');
    j.driver('departed', 'load', { values: { reason: 'not ready' } });
    const after = evaluateTrip(tripWith([callAshot]), j.events, BASE_CATALOG);
    expect(after.stages[0]?.requirements[0]?.visible).toBe(true);
    expect(after.events.every((e) => e.result === 'applied')).toBe(true);
  });

  it('"Acknowledged" blocks the start of work until confirmed', () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    const start = j.driver('loading_started', 'load');
    const r = evaluateTrip(tripWith([noTiers]), j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === start.id)?.conflict).toEqual({ reason: 'requirements_unmet', details: ['load:m1'] });

    const ok = new Journal();
    ok.driver('arrived', 'load');
    ack(ok, noTiers);
    ok.driver('loading_started', 'load');
    const r2 = evaluateTrip(tripWith([noTiers]), ok.events, BASE_CATALOG);
    expect(r2.events.every((e) => e.result === 'applied')).toBe(true);
    expect(r2.stages[0]?.requirements[0]?.fulfilled).toBe(true);
  });

  it('can be acknowledged before arrival', () => {
    const j = new Journal();
    const a = ack(j, noTiers);
    expect(evaluateTrip(tripWith([noTiers]), j.events, BASE_CATALOG).events.find((e) => e.eventId === a.id)?.result).toBe('applied');
  });

  it('a changed requirement must be acknowledged again', () => {
    const j = new Journal();
    j.driver('arrived', 'load');
    ack(j, noTiers, 1);
    const start = j.driver('loading_started', 'load');
    const changed = { ...noTiers, title: 'Не грузить выше 1 яруса', revision: 2 };
    const r = evaluateTrip(tripWith([changed]), j.events, BASE_CATALOG);
    expect(r.events.find((e) => e.eventId === start.id)?.conflict?.reason).toBe('requirements_unmet');
    expect(r.stages[0]?.requirements[0]).toMatchObject({ revision: 2, fulfilled: false });
  });

  it('defaults of the stage type and the ones of this trip live in the same list', () => {
    const defaults = materializeRequirements({ id: 'load', typeCode: 'loading' }, { tags: ['adr'] }, BASE_CATALOG);
    const list = [...defaults, callAshot, noTiers, strapsPhoto];
    const r = evaluateTrip(tripWith(list), [], BASE_CATALOG);
    expect(r.stages[0]?.requirements.map((x) => x.id)).toEqual([
      'load:loading_process_photos',
      'load:seal_number',
      'load:seal_photo',
      'load:cmr_signed',
      'load:adr_parking',
      'load:m0',
      'load:m1',
      'load:m2',
    ]);
  });
});
