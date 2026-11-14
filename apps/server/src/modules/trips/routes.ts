import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { TRIP_STATES } from '@plobi/core';
import { currentUser, requireRole } from '../../platform/http.js';
import type { CreateTripInput, TripService } from './service.js';

const Ref = Type.Union([Type.Object({ id: Type.String() }), Type.Object({ externalId: Type.String() })]);
const Loose = Type.Record(Type.String(), Type.Unknown());

const StageBody = Type.Object({
  type: Type.String({ minLength: 1 }),
  externalId: Type.Optional(Type.String()),
  place: Type.Optional(Ref),
  assigneeId: Type.Optional(Type.String({ format: 'uuid' })),
  tags: Type.Optional(Type.Array(Type.String())),
  details: Type.Optional(Loose),
  requirements: Type.Optional(Type.Array(Loose)),
});

const TripBody = Type.Object({
  number: Type.String({ minLength: 1 }),
  externalId: Type.Optional(Type.String()),
  driver: Type.Optional(Ref),
  tags: Type.Optional(Type.Array(Type.String())),
  vehicle: Type.Optional(Loose),
  cargo: Type.Optional(Loose),
  customFields: Type.Optional(Loose),
  stages: Type.Array(StageBody, { minItems: 1 }),
});

const Attachment = Type.Object(
  {
    id: Type.String(),
    kind: Type.Union(['photo', 'video', 'document', 'signature'].map((k) => Type.Literal(k))),
    source: Type.Union(['camera', 'gallery', 'api'].map((k) => Type.Literal(k))),
    capturedAt: Type.Optional(Type.String({ format: 'date-time' })),
    field: Type.Optional(Type.String()),
    requirementId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const EventBody = Type.Object({
  id: Type.String({ minLength: 8, maxLength: 64 }),
  typeCode: Type.String({ minLength: 1 }),
  stageId: Type.Optional(Type.String()),
  occurredAt: Type.String({ format: 'date-time' }),
  values: Type.Optional(Loose),
  attachments: Type.Optional(Type.Array(Attachment)),
  forced: Type.Optional(Type.Boolean()),
  acceptUnmet: Type.Optional(Type.Boolean()),
});

const TripId = Type.Object({ id: Type.String({ format: 'uuid' }) });

export function tripRoutes(service: TripService): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get(
      '/trips',
      {
        schema: {
          tags: ['trips'],
          querystring: Type.Object({ state: Type.Optional(Type.Union(TRIP_STATES.map((s) => Type.Literal(s)))) }),
        },
      },
      async (req) => service.listTrips(currentUser(req), req.query.state ? { state: req.query.state } : {}),
    );

    /** A whole trip in one request: points with places and requirements. Transits are inserted. */
    app.post('/trips', { schema: { tags: ['trips'], body: TripBody } }, async (req, reply) => {
      requireRole(req, 'admin', 'dispatcher');
      return reply.status(201).send(await service.createTrip(req.body as CreateTripInput));
    });

    app.get('/trips/:id', { schema: { tags: ['trips'], params: TripId } }, async (req) =>
      service.getTrip(req.params.id, currentUser(req)),
    );

    app.get(
      '/trips/:id/available-events',
      {
        schema: {
          tags: ['trips'],
          params: TripId,
          querystring: Type.Object({ stageId: Type.Optional(Type.String()), forced: Type.Optional(Type.Boolean()) }),
        },
      },
      async (req) => service.available(req.params.id, currentUser(req), req.query),
    );

    /** Online: 409 if the event does not fit; nothing is stored then. */
    app.post('/trips/:id/events', { schema: { tags: ['events'], params: TripId, body: EventBody } }, async (req, reply) => {
      const { result, trip } = await service.submitEvent(req.params.id, req.body, currentUser(req));
      return reply.status(201).send({ result, trip });
    });

    /** Offline queue: everything is stored; events that no longer fit are kept as conflicts. */
    app.post(
      '/events/batch',
      {
        schema: {
          tags: ['events'],
          body: Type.Object({
            events: Type.Array(Type.Intersect([EventBody, Type.Object({ tripId: Type.String({ format: 'uuid' }) })]), {
              maxItems: 500,
            }),
          }),
        },
      },
      async (req) => ({ results: await service.submitBatch(req.body.events, currentUser(req)) }),
    );
  };
}
