import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type Api } from './setup.js';

let api: Api;
beforeAll(async () => {
  api = await startApp();
});
afterAll(async () => {
  await api.app.close();
});

describe('identity', () => {
  it('rejects a wrong password without telling whether the login exists', async () => {
    const wrong = await api.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { login: 'admin', password: 'nope' } });
    const unknown = await api.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { login: 'ghost', password: 'nope' } });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
  });

  it('requires a session for protected routes', async () => {
    expect((await api.as('invalid-token').get('/me')).status).toBe(401);
  });

  it('only an admin creates users', async () => {
    const driver = await api.user('driver');
    const res = await driver.api.post('/users', { login: 'x1', password: 'password-123', name: 'X', role: 'driver' });
    expect(res.status).toBe(403);
    expect((await driver.api.get('/me')).body.role).toBe('driver');
  });

  it('a deactivated user loses their sessions', async () => {
    const driver = await api.user('driver');
    await api.patch(`/users/${driver.id}`, { isActive: false });
    expect((await driver.api.get('/me')).status).toBe(401);
  });
});

describe('catalog', () => {
  it('is seeded with the base catalog on first start', async () => {
    const catalog = (await api.get('/catalog')).body;
    expect(Object.keys(catalog.stageTypes)).toContain('loading');
    expect(catalog.eventTypes.departed.setsPhase).toBe('departed');
  });

  it('refuses a change that would break it', async () => {
    const res = await api.put('/catalog/items/event_type/teleported', {
      name: { ru: 'Телепортировался' },
      action: 'phase',
      setsPhase: 'arrived',
      scope: { stageTypes: ['no_such_stage_type'] },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('catalog_invalid');
    expect((await api.get('/catalog')).body.eventTypes.teleported).toBeUndefined();
  });

  it('accepts a new event type and hides a system one', async () => {
    const add = await api.put('/catalog/items/event_type/gate_opened', {
      name: { ru: 'Ворота открыты' },
      action: 'detail',
      scope: { stageTypes: ['loading'], phases: ['arrived'], roles: ['driver'] },
    });
    expect(add.status).toBe(200);
    await api.post('/catalog/items/event_type/at_dock/hide', { hidden: true });
    const catalog = (await api.get('/catalog')).body;
    expect(catalog.eventTypes.gate_opened.code).toBe('gate_opened');
    expect(catalog.eventTypes.at_dock).toBeUndefined();
  });
});

describe('automata', () => {
  it('describes the machines with diagrams generated from code', async () => {
    const body = (await api.get('/state-machines')).body;
    expect(body.profiles.transit.final).toBe('completed');
    expect(body.diagrams.profiles.point_single).toContain('started --> departed');
  });

  it('maps a stage type: events and requirements on each transition', async () => {
    const map = (await api.get('/stage-types/loading/map')).body;
    const departure = map.transitions.find((t: any) => t.from === 'completed' && t.to === 'departed');
    expect(departure.requirements.map((r: any) => r.code)).toContain('cmr_signed');
    expect(map.diagram).toContain('completed --> departed: departed');
  });

  it('simulates a trip without storing it', async () => {
    const res = await api.post('/simulate', {
      stages: [
        { id: 'a', typeCode: 'waypoint' },
        { id: 'b', typeCode: 'waypoint' },
      ],
      events: [
        { id: 'e1', typeCode: 'arrived', stageId: 'a', occurredAt: '2026-11-20T06:00:00Z', authorId: 'd', authorRole: 'driver' },
        { id: 'e2', typeCode: 'departed', stageId: 'a', occurredAt: '2026-11-20T06:10:00Z', authorId: 'd', authorRole: 'driver' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.stages.map((s: any) => s.state)).toEqual(['passed', 'in_progress', 'ahead']);
  });
});
