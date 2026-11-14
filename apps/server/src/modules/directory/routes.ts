import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { currentUser, requireRole } from '../../platform/http.js';
import type { DirectoryService } from './service.js';

const Contact = Type.Object({ name: Type.String(), phone: Type.String(), role: Type.Optional(Type.String()) });

/** Content of an instruction, as in customer and catalog rules. */
const InstructionContent = Type.Object(
  {
    kind: Type.Union(['text', 'contact', 'photo', 'location', 'file', 'voice', 'link'].map((k) => Type.Literal(k))),
    showAt: Type.Union(['always', 'arrived', 'started', 'completed'].map((k) => Type.Literal(k))),
  },
  { additionalProperties: true },
);

/** A permanent place instruction has its own id, so stages can reference it. */
const Instruction = Type.Intersect([InstructionContent, Type.Object({ id: Type.String() })]);

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
  instructions: Type.Optional(Type.Array(Instruction)),
  tags: Type.Optional(Type.Array(Type.String())),
});

const CustomerBody = Type.Object({
  name: Type.String({ minLength: 1 }),
  externalId: Type.Optional(Type.String()),
  contacts: Type.Optional(Type.Array(Contact)),
});

const Rule = Type.Object({}, { additionalProperties: true });
const CustomerRulesBody = Type.Object({
  requirements: Type.Array(Type.Intersect([Rule, Type.Object({ template: Type.String() })])),
  instructions: Type.Array(Type.Intersect([Rule, Type.Object({ code: Type.String(), instruction: InstructionContent })])),
});

const Id = Type.Object({ id: Type.String({ format: 'uuid' }) });
const Ext = Type.Object({ externalId: Type.String({ minLength: 1 }) });
const Query = Type.Object({ query: Type.Optional(Type.String()) });

/** Who may edit places and customers. */
const EDITORS = ['admin', 'dispatcher'] as const;

export function directoryRoutes(directory: DirectoryService): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get('/places', { schema: { tags: ['places'], querystring: Query } }, async (req) => {
      currentUser(req);
      return directory.listPlaces(req.query.query);
    });
    app.get('/places/:id', { schema: { tags: ['places'], params: Id } }, async (req) => {
      currentUser(req);
      return directory.findPlace({ id: req.params.id });
    });
    app.post('/places', { schema: { tags: ['places'], body: PlaceBody } }, async (req, reply) => {
      requireRole(req, ...EDITORS);
      return reply.status(201).send(await directory.createPlace(req.body));
    });
    app.patch('/places/:id', { schema: { tags: ['places'], params: Id, body: Type.Partial(PlaceBody) } }, async (req) => {
      requireRole(req, ...EDITORS);
      return directory.updatePlace(req.params.id, req.body);
    });
    app.put(
      '/places/by-external-id/:externalId',
      { schema: { tags: ['places'], params: Ext, body: PlaceBody } },
      async (req) => {
        requireRole(req, ...EDITORS);
        return directory.upsertPlaceByExternalId(req.params.externalId, req.body);
      },
    );

    app.get('/customers', { schema: { tags: ['customers'], querystring: Query } }, async (req) => {
      currentUser(req);
      return directory.listCustomers(req.query.query);
    });
    app.post('/customers', { schema: { tags: ['customers'], body: CustomerBody } }, async (req, reply) => {
      requireRole(req, ...EDITORS);
      return reply.status(201).send(await directory.createCustomer(req.body));
    });
    app.put(
      '/customers/by-external-id/:externalId',
      { schema: { tags: ['customers'], params: Ext, body: CustomerBody } },
      async (req) => {
        requireRole(req, ...EDITORS);
        return directory.upsertCustomerByExternalId(req.params.externalId, req.body);
      },
    );
    app.get('/customers/:id/rules', { schema: { tags: ['customers'], params: Id } }, async (req) => {
      requireRole(req, ...EDITORS);
      return directory.customerRules(req.params.id);
    });
    app.put(
      '/customers/:id/rules',
      { schema: { tags: ['customers'], params: Id, body: CustomerRulesBody } },
      async (req) => {
        requireRole(req, ...EDITORS);
        // Shape of each rule is validated by the catalog check (core types).
        return { issues: await directory.setCustomerRules(req.params.id, req.body as never) };
      },
    );
  };
}
