import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { currentUser, requireRole } from '../../platform/http.js';
import type { PlaceService } from './service.js';

const Contact = Type.Object({ name: Type.String(), phone: Type.String(), role: Type.Optional(Type.String()) });

const PlaceBody = Type.Object({
  name: Type.String({ minLength: 1 }),
  externalId: Type.Optional(Type.String()),
  kind: Type.Optional(Type.String()),
  address: Type.Optional(Type.String()),
  lat: Type.Optional(Type.Number()),
  lon: Type.Optional(Type.Number()),
  timezone: Type.Optional(Type.String()),
  workingHours: Type.Optional(Type.String()),
  contacts: Type.Optional(Type.Array(Contact)),
  tags: Type.Optional(Type.Array(Type.String())),
});

const Id = Type.Object({ id: Type.String({ format: 'uuid' }) });
const EDITORS = ['admin', 'dispatcher'] as const;

export function placeRoutes(places: PlaceService): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get('/places', { schema: { tags: ['places'], querystring: Type.Object({ query: Type.Optional(Type.String()) }) } }, async (req) => {
      currentUser(req);
      return places.list(req.query.query);
    });
    app.get('/places/:id', { schema: { tags: ['places'], params: Id } }, async (req) => {
      currentUser(req);
      return places.find({ id: req.params.id });
    });
    app.post('/places', { schema: { tags: ['places'], body: PlaceBody } }, async (req, reply) => {
      requireRole(req, ...EDITORS);
      return reply.status(201).send(await places.create(req.body));
    });
    app.patch('/places/:id', { schema: { tags: ['places'], params: Id, body: Type.Partial(PlaceBody) } }, async (req) => {
      requireRole(req, ...EDITORS);
      return places.update(req.params.id, req.body);
    });
    app.put(
      '/places/by-external-id/:externalId',
      { schema: { tags: ['places'], params: Type.Object({ externalId: Type.String({ minLength: 1 }) }), body: PlaceBody } },
      async (req) => {
        requireRole(req, ...EDITORS);
        return places.upsertByExternalId(req.params.externalId, req.body);
      },
    );
  };
}
