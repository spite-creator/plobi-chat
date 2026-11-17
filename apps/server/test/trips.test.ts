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

afterAll(async () => {
  await admin.app.close();
});

/** Requirements sent with the stage. In the base catalog only information can be used yet. */
const CALL_ASHOT = { kind: 'info', title: 'Позвони Ашоту, он откроет ворота', contact: { name: 'Ашот', phone: '+7 900 000-00-00' }, showAt: 'arrived' };

async function createTrip(stages: unknown[] = [
  { type: 'loading', place: { externalId: 'WH-NORTH' }, requirements: [CALL_ASHOT] },
  { type: 'unloading', details: { address: 'Warszawa, Magazynowa 5', timezone: 'Europe/Warsaw' } },
]) {
  const res = await dispatcher.post('/trips', { number: `R-${Math.random().toString(36).slice(2, 7)}`, driver: { id: driver.id }, stages });
  expect(res.status).toBe(201);
  return res.body;
}

/** An event as the driver app or an integration sends it: what happened and when, no stage. */
const event = (typeCode: string, extra: Record<string, unknown> = {}) => ({ id: eventId(), typeCode, occurredAt: nextTime(), ...extra });
const send = (api: Api, tripId: string, typeCode: string, extra?: Record<string, unknown>) =>
  api.post(`/trips/${tripId}/events`, event(typeCode, extra));

describe('creating a trip', () => {
  it('inserts the transit; the place gives the address; requirements come with the stage', async () => {
    const trip = await createTrip();
    expect(trip.stages.map((s: any) => [s.typeCode, s.isAuto, s.mode])).toEqual([
      ['loading', false, undefined],
      ['transit', true, 'road'],
      ['unloading', false, undefined],
    ]);
    expect(trip.stages[0]).toMatchObject({ placeId, details: { address: 'Москва, Складская 1' } });
    expect(trip.stages[0].requirements).toEqual([
      expect.objectContaining({ kind: 'info', title: CALL_ASHOT.title, visible: false, fulfilled: true, source: 'manual' }),
    ]);
    expect(trip.state).toBe('assigned');
  });

  it('refuses an unknown stage type, a malformed requirement and a duplicate external id', async () => {
    expect((await dispatcher.post('/trips', { number: 'X', stages: [{ type: 'teleport' }] })).body.code).toBe('unknown_stage_type');
    const noPhase = await dispatcher.post('/trips', { number: 'X', stages: [{ type: 'loading', requirements: [{ kind: 'photo', title: 'Фото' }] }] });
    expect(noPhase.body.code).toBe('invalid_requirement');
    await dispatcher.post('/trips', { number: 'Y', externalId: '1C-77', stages: [{ type: 'waypoint' }] });
    expect((await dispatcher.post('/trips', { number: 'Y', externalId: '1C-77', stages: [{ type: 'waypoint' }] })).status).toBe(409);
  });

  it('drivers cannot create trips and see only their own', async () => {
    expect((await driver.api.post('/trips', { number: 'Z', stages: [{ type: 'waypoint' }] })).status).toBe(403);
    const trip = await createTrip();
    expect((await otherDriver.api.get(`/trips/${trip.id}`)).status).toBe(403);
    expect((await driver.api.get('/trips')).body.map((t: any) => t.id)).toContain(trip.id);
  });
});

describe('the journal online', () => {
  it('places events itself and runs the trip to the end', async () => {
    const trip = await createTrip();
    const [load, road, unload] = trip.stages.map((s: any) => s.id);

    const arrived = await send(driver.api, trip.id, 'arrived');
    expect(arrived.body.result).toMatchObject({ result: 'applied', stageId: load });
    expect(arrived.body.trip.stages[0].requirements[0].visible).toBe(true); // "call Ashot" shows on arrival

    await send(driver.api, trip.id, 'loading_started');
    await send(driver.api, trip.id, 'loaded');
    const departed = await send(driver.api, trip.id, 'departed');
    expect(departed.body.result.effects).toEqual([`stage:${load} departed`, `stage:${road} started (auto)`]);

    await send(driver.api, trip.id, 'rest');
    await send(driver.api, trip.id, 'in_transit');
    await send(driver.api, trip.id, 'arrived');
    await send(driver.api, trip.id, 'unloading_started');
    const unloaded = await send(driver.api, trip.id, 'unloaded');
    expect(unloaded.body.result.effects).toEqual([`stage:${unload} completed`, `stage:${unload} departed (auto)`]);

    const full = (await dispatcher.get(`/trips/${trip.id}`)).body;
    expect(full.state).toBe('finished');
    expect(full.stages[1].pauses).toEqual([expect.objectContaining({ reason: 'rest' })]);
    expect(full.journal.every((e: any) => e.result.result === 'applied' && e.authorId === driver.id)).toBe(true);
  });

  it('refuses what does not fit, with the reason; a repeated id is idempotent', async () => {
    const trip = await createTrip();
    await send(driver.api, trip.id, 'arrived');
    await send(driver.api, trip.id, 'loading_started');
    const rest = await send(driver.api, trip.id, 'rest');
    expect(rest.status).toBe(409);
    expect(rest.body.details).toEqual({ reason: 'not_placed', details: ['Событие транзита, а машина на точке «loading»'] });

    const e = event('downtime');
    expect((await driver.api.post(`/trips/${trip.id}/events`, e)).status).toBe(201);
    expect((await driver.api.post(`/trips/${trip.id}/events`, e)).status).toBe(201);
    expect((await driver.api.get(`/trips/${trip.id}`)).body.journal).toHaveLength(3);
  });

  it('a cancelled event stays in the journal and phases are recomputed without it', async () => {
    const trip = await createTrip();
    const arrived = event('arrived');
    await driver.api.post(`/trips/${trip.id}/events`, arrived);
    const res = await dispatcher.post(`/trips/${trip.id}/events/${arrived.id}/cancel`, { reason: 'Нет во внешней системе' });
    expect(res.status).toBe(200);
    expect(res.body.stages[0].phase).toBeNull();
    const full = (await dispatcher.get(`/trips/${trip.id}`)).body;
    expect(full.journal[0]).toMatchObject({ cancelled: true, result: { cancelled: true, stageId: trip.stages[0].id } });
  });

  it('observers cannot submit events', async () => {
    const trip = await createTrip();
    const observer = await admin.user('observer');
    expect((await send(observer.api, trip.id, 'arrived')).status).toBe(403);
  });
});

describe('offline sync', () => {
  it('stores everything, keeps misfits as conflicts, orders by time', async () => {
    const trip = await createTrip();
    const [load, road, unload] = trip.stages.map((s: any) => s.id);
    const arrived = event('arrived');
    const loaded = event('loaded');
    const departed = event('departed');
    const atUnload = event('arrived');
    const late = event('loading_started'); // loading is already behind: never sent before, a conflict

    const res = await driver.api.post('/events/batch', {
      events: [late, atUnload, departed, loaded, arrived].map((e) => ({ ...e, tripId: trip.id })),
    });
    const byId = new Map(res.body.results.map((r: any) => [r.eventId, r]));
    expect(byId.get(arrived.id)).toMatchObject({ result: 'applied', stageId: load });
    expect(byId.get(atUnload.id)).toMatchObject({ result: 'applied', stageId: unload, effects: [`stage:${road} completed (auto)`, `stage:${unload} arrived`] });
    expect(byId.get(late.id)).toMatchObject({ result: 'conflict', conflict: { reason: 'not_placed' } });

    const full = (await dispatcher.get(`/trips/${trip.id}`)).body;
    expect(full.journal).toHaveLength(5);
    expect(full.stages.map((s: any) => s.state)).toEqual(['passed', 'passed', 'in_progress']);
  });
});

describe('handover → takeover with two drivers', () => {
  it('the receiving driver leads on; the first one cannot act for them; a fast crossing closes itself', async () => {
    const trip = await createTrip([
      { type: 'handover', details: { address: 'Склад Северный' } },
      { type: 'takeover', assigneeId: otherDriver.id, details: { address: 'Склад Северный' } },
      { type: 'border_open', details: { address: 'Франкфурт-на-Одере' } },
      { type: 'unloading' },
    ]);
    expect(trip.stages.map((s: any) => s.typeCode)).toEqual(['handover', 'takeover', 'transit', 'border_open', 'transit', 'unloading']);
    expect(trip.stages.map((s: any) => s.assigneeId)).toEqual([driver.id, otherDriver.id, otherDriver.id, otherDriver.id, otherDriver.id, otherDriver.id]);
    const [, take, , border, , unload] = trip.stages.map((s: any) => s.id);

    for (const code of ['arrived', 'handover_started', 'handed_over']) {
      expect((await send(driver.api, trip.id, code)).status).toBe(201);
    }
    const wrong = await send(driver.api, trip.id, 'arrived');
    expect(wrong.status).toBe(409);
    expect(wrong.body.details).toEqual({ reason: 'out_of_scope', details: ['assignee'] });

    expect((await otherDriver.api.get('/trips')).body.map((t: any) => t.id)).toContain(trip.id);
    for (const code of ['arrived', 'takeover_started', 'taken_over', 'departed']) {
      const r = await send(otherDriver.api, trip.id, code);
      expect(r.status).toBe(201);
      expect(r.body.result.stageId).toBe(take);
    }
    const arrival = await send(otherDriver.api, trip.id, 'arrived');
    expect(arrival.body.result.stageId).toBe(unload);
    expect(arrival.body.trip.stages.find((s: any) => s.id === border)).toMatchObject({ state: 'passed', autoPassed: true });
  });
});
