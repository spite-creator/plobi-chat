import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventId, nextTime, startApp, type Api } from './setup.js';

let admin: Api;
let dispatcher: Api;
let driver: { id: string; api: Api };
let otherDriver: { id: string; api: Api };
let placeId: string;

beforeAll(async () => {
  admin = await startApp();
  dispatcher = (await admin.user('dispatcher')).api;
  driver = await admin.user('driver', 'ivan');
  otherDriver = await admin.user('driver', 'petr');

  placeId = (
    await dispatcher.post('/places', {
      name: 'Склад «Северный»',
      externalId: 'WH-NORTH',
      address: 'Москва, Складская 1',
      lat: 55.75,
      lon: 37.61,
      timezone: 'Europe/Moscow',
    })
  ).body.id;
});

/** Requirements sent with the stage: what the driver must see and do there. */
const LOADING_REQUIREMENTS = [
  { kind: 'info', title: 'Позвони Ашоту, он откроет ворота', contact: { name: 'Ашот', phone: '+7 900 000-00-00' }, showAt: 'arrived' },
  { kind: 'acknowledgement', title: 'Не более 2 ярусов', showAt: 'arrived', beforePhase: 'started' },
];

afterAll(async () => {
  await admin.app.close();
});

async function createTrip(extra: Record<string, unknown> = {}) {
  const res = await dispatcher.post('/trips', {
    number: `R-${Math.random().toString(36).slice(2, 7)}`,
    driver: { id: driver.id },
    stages: [
      {
        type: 'loading',
        place: { externalId: 'WH-NORTH' },
        details: { windowFrom: '2026-11-20T06:00:00Z' },
        requirements: LOADING_REQUIREMENTS,
      },
      { type: 'unloading', details: { address: 'Warszawa, Magazynowa 5', timezone: 'Europe/Warsaw' } },
    ],
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body;
}

const event = (typeCode: string, stageId?: string, extra: Record<string, unknown> = {}) => ({
  id: eventId(),
  typeCode,
  ...(stageId ? { stageId } : {}),
  occurredAt: nextTime(),
  ...extra,
});

describe('creating a trip', () => {
  it('inserts the transit; a stage gets its defaults plus the requirements sent with it', async () => {
    const trip = await createTrip();
    expect(trip.stages.map((s: any) => [s.typeCode, s.isAuto])).toEqual([
      ['loading', false],
      ['transit', true],
      ['unloading', false],
    ]);
    const loading = trip.stages[0];
    expect(loading.placeId).toBe(placeId);
    expect(loading.details.address).toBe('Москва, Складская 1');
    expect(loading.requirements.map((r: any) => [r.source, r.kind, r.template ?? r.title])).toEqual([
      ['stage_type', 'photo', 'loading_process_photos'],
      ['stage_type', 'scan', 'seal_number'],
      ['stage_type', 'photo', 'seal_photo'],
      ['stage_type', 'document', 'cmr_signed'],
      ['manual', 'info', 'Позвони Ашоту, он откроет ворота'],
      ['manual', 'acknowledgement', 'Не более 2 ярусов'],
    ]);
    expect(loading.requirements[4]).toMatchObject({ visible: false, fulfilled: true, contact: { name: 'Ашот' } });
    expect(trip.state).toBe('assigned');
  });

  it('refuses an unknown stage type, a malformed requirement and a duplicate external id', async () => {
    const bad = await dispatcher.post('/trips', { number: 'X', stages: [{ type: 'teleport' }] });
    expect(bad.body.code).toBe('unknown_stage_type');
    const noPhase = await dispatcher.post('/trips', {
      number: 'X',
      stages: [{ type: 'loading', requirements: [{ kind: 'photo', title: 'Фото' }] }],
    });
    expect(noPhase.body.code).toBe('invalid_requirement');
    await createTrip({ externalId: '1C-77' });
    const dup = await dispatcher.post('/trips', { number: 'Y', externalId: '1C-77', stages: [{ type: 'waypoint' }] });
    expect(dup.status).toBe(409);
  });

  it('drivers cannot create trips and see only their own', async () => {
    expect((await driver.api.post('/trips', { number: 'Z', stages: [{ type: 'waypoint' }] })).status).toBe(403);
    const trip = await createTrip();
    expect((await otherDriver.api.get(`/trips/${trip.id}`)).status).toBe(403);
    const mine = (await driver.api.get('/trips')).body.map((t: any) => t.id);
    expect(mine).toContain(trip.id);
    expect((await otherDriver.api.get('/trips')).body).toEqual([]);
  });
});

describe('the event journal online', () => {
  it('runs a loading: acknowledgement, requirements, departure starts the transit', async () => {
    const trip = await createTrip();
    const load = trip.stages[0].id;
    const ack = trip.stages[0].requirements.find((r: any) => r.kind === 'acknowledgement');

    expect((await driver.api.post(`/trips/${trip.id}/events`, event('arrived', load))).status).toBe(201);

    // "No more than 2 tiers" must be acknowledged before work starts.
    const early = await driver.api.post(`/trips/${trip.id}/events`, event('loading_started', load));
    expect(early.status).toBe(409);
    expect(early.body.details).toEqual({ reason: 'requirements_unmet', details: [ack.id] });

    await driver.api.post(`/trips/${trip.id}/events`, event('acknowledged', load, { values: { requirementId: ack.id, revision: 1 } }));
    await driver.api.post(`/trips/${trip.id}/events`, event('loading_started', load));
    await driver.api.post(`/trips/${trip.id}/events`, event('loaded', load));

    const blocked = await driver.api.post(`/trips/${trip.id}/events`, event('departed', load));
    expect(blocked.status).toBe(409);
    expect(blocked.body.details.reason).toBe('requirements_unmet');

    // The buttons show departure with what is still missing.
    const buttons = (await driver.api.get(`/trips/${trip.id}/available-events?stageId=${load}`)).body;
    expect(buttons.find((b: any) => b.typeCode === 'departed').requirementsUnmet).toHaveLength(4);

    // Dispatcher waives everything with a reason; then departure goes through.
    for (const r of trip.stages[0].requirements.filter((x: any) => x.template)) {
      const w = await dispatcher.post(`/trips/${trip.id}/events`, event('requirement_waived', load, { values: { requirementId: r.id, reason: 'client agreed' } }));
      expect(w.status).toBe(201);
    }
    const dep = await driver.api.post(`/trips/${trip.id}/events`, event('departed', load));
    expect(dep.status).toBe(201);
    expect(dep.body.result.effects).toEqual([`stage:${trip.stages[1].id} started`]);
    expect(dep.body.trip.currentStageId).toBe(trip.stages[1].id);

    const full = (await dispatcher.get(`/trips/${trip.id}`)).body;
    expect(full.state).toBe('in_progress');
    expect(full.journal.every((e: any) => e.result.result === 'applied')).toBe(true);
    expect(full.journal.every((e: any) => e.authorId === driver.id || e.authorRole === 'dispatcher')).toBe(true);
  });

  it('is idempotent for a repeated event id', async () => {
    const trip = await createTrip();
    const e = event('arrived', trip.stages[0].id);
    const first = await driver.api.post(`/trips/${trip.id}/events`, e);
    const again = await driver.api.post(`/trips/${trip.id}/events`, e);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect((await driver.api.get(`/trips/${trip.id}`)).body.journal).toHaveLength(1);
  });

  it('refuses an event that would invalidate already accepted ones', async () => {
    const trip = await createTrip();
    const load = trip.stages[0].id;
    const arrivedAt = nextTime();
    await driver.api.post(`/trips/${trip.id}/events`, { id: eventId(), typeCode: 'arrived', stageId: load, occurredAt: arrivedAt });
    // Skipping the stage *before* the arrival would turn the arrival into a conflict.
    const before = new Date(Date.parse(arrivedAt) - 60_000).toISOString();
    const skip = await dispatcher.post(`/trips/${trip.id}/events`, {
      id: eventId(),
      typeCode: 'stage_skipped',
      stageId: load,
      occurredAt: before,
      values: { reason: 'late correction' },
    });
    expect(skip.status).toBe(409);
    expect(skip.body.code).toBe('event_breaks_journal');
  });

  it('observers cannot submit events', async () => {
    const trip = await createTrip();
    const observer = await admin.user('observer');
    expect((await observer.api.post(`/trips/${trip.id}/events`, event('arrived', trip.stages[0].id))).status).toBe(403);
  });
});

describe('offline sync', () => {
  it('stores everything, keeps misfits as conflicts, and orders by occurredAt', async () => {
    const trip = await createTrip();
    const [load, road, unload] = trip.stages.map((s: any) => s.id);
    const arrived = event('arrived', load);
    const departed = event('departed', load, { values: { reason: 'cargo not ready' } });
    const atUnload = event('arrived', unload);
    const nonsense = event('unloaded', unload); // not allowed right after arrival: work never started

    // Sent in reverse order, as a phone might after a long time without signal.
    const res = await driver.api.post('/events/batch', {
      events: [nonsense, atUnload, departed, arrived].map((e) => ({ ...e, tripId: trip.id })),
    });
    expect(res.status).toBe(200);
    const byId = new Map(res.body.results.map((r: any) => [r.eventId, r]));
    expect(byId.get(arrived.id)).toMatchObject({ result: 'applied' });
    expect(byId.get(departed.id)).toMatchObject({ result: 'applied' });
    expect(byId.get(atUnload.id)).toMatchObject({ result: 'applied', effects: [`stage:${road} completed`] });
    expect(byId.get(nonsense.id)).toMatchObject({ result: 'conflict', conflict: { reason: 'invalid_transition' } });

    const full = (await dispatcher.get(`/trips/${trip.id}`)).body;
    expect(full.journal).toHaveLength(4);
    expect(full.stages.map((s: any) => s.state)).toEqual(['passed', 'passed', 'in_progress']);
    expect(full.stages[0].requirements.filter((r: any) => r.kind !== 'info').every((r: any) => r.notApplicable)).toBe(true);
  });

  it('a retried batch does not duplicate anything', async () => {
    const trip = await createTrip();
    const events = [event('arrived', trip.stages[0].id)].map((e) => ({ ...e, tripId: trip.id }));
    await driver.api.post('/events/batch', { events });
    await driver.api.post('/events/batch', { events });
    expect((await driver.api.get(`/trips/${trip.id}`)).body.journal).toHaveLength(1);
  });
});

describe('handover → takeover with two drivers', () => {
  it('the receiving driver sees the trip and leads it on; the first one cannot act for them', async () => {
    const res = await dispatcher.post('/trips', {
      number: 'R-HANDOVER',
      driver: { id: driver.id },
      stages: [
        { type: 'handover', details: { address: 'Склад Северный' } },
        { type: 'takeover', assigneeId: otherDriver.id, details: { address: 'Склад Северный' } },
        { type: 'border_open', details: { address: 'Франкфурт-на-Одере' } },
        { type: 'unloading' },
      ],
    });
    expect(res.status).toBe(201);
    const trip = res.body;
    expect(trip.stages.map((s: any) => s.typeCode)).toEqual(['handover', 'takeover', 'transit', 'border_open', 'transit', 'unloading']);
    expect(trip.stages.map((s: any) => s.assigneeId)).toEqual([driver.id, otherDriver.id, otherDriver.id, otherDriver.id, otherDriver.id, otherDriver.id]);

    const [hand, take, , border, , unload] = trip.stages.map((s: any) => s.id);
    // Driver 1 hands over; requirements waived to keep the scenario short.
    await driver.api.post(`/trips/${trip.id}/events`, event('arrived', hand));
    for (const r of trip.stages[0].requirements) {
      await dispatcher.post(`/trips/${trip.id}/events`, event('requirement_waived', hand, { values: { requirementId: r.id, reason: 'test' } }));
    }
    await driver.api.post(`/trips/${trip.id}/events`, event('handover_started', hand));
    await driver.api.post(`/trips/${trip.id}/events`, event('handed_over', hand, { values: { transferred: ['cargo'] } }));
    expect((await driver.api.post(`/trips/${trip.id}/events`, event('departed', hand))).status).toBe(201);

    // Driver 1 may not take over for driver 2.
    const wrong = await driver.api.post(`/trips/${trip.id}/events`, event('arrived', take));
    expect(wrong.status).toBe(409);
    expect(wrong.body.details).toEqual({ reason: 'out_of_scope', details: ['assignee'] });

    // Driver 2 sees the trip and takes over.
    expect((await otherDriver.api.get('/trips')).body.map((t: any) => t.id)).toContain(trip.id);
    for (const r of trip.stages[1].requirements) {
      await dispatcher.post(`/trips/${trip.id}/events`, event('requirement_waived', take, { values: { requirementId: r.id, reason: 'test' } }));
    }
    for (const code of ['arrived', 'takeover_started']) {
      expect((await otherDriver.api.post(`/trips/${trip.id}/events`, event(code, take))).status).toBe(201);
    }
    await otherDriver.api.post(`/trips/${trip.id}/events`, event('taken_over', take, { values: { transferred: ['cargo'] } }));
    await otherDriver.api.post(`/trips/${trip.id}/events`, event('departed', take));

    // He drives through the fast border crossing without pressing "passed".
    const arrival = await otherDriver.api.post(`/trips/${trip.id}/events`, event('arrived', unload));
    expect(arrival.status).toBe(201);
    const stages = arrival.body.trip.stages;
    expect(stages.find((s: any) => s.id === border)).toMatchObject({ state: 'passed', autoPassed: true });
    expect(arrival.body.trip.currentStageId).toBe(unload);
  });
});

