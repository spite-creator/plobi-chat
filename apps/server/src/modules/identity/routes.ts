import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { bearerToken, currentUser, requireRole } from '../../platform/http.js';
import { USER_ROLES } from './schema.js';
import type { IdentityService } from './service.js';

const Role = Type.Union(USER_ROLES.map((r) => Type.Literal(r)));

const UserBody = Type.Object({
  login: Type.String({ minLength: 2 }),
  password: Type.String({ minLength: 8 }),
  name: Type.String({ minLength: 1 }),
  role: Role,
  externalId: Type.Optional(Type.String()),
  phone: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  locale: Type.Optional(Type.String()),
  timezone: Type.Optional(Type.String()),
});

const UserPatch = Type.Partial(
  Type.Object({
    password: Type.String({ minLength: 8 }),
    name: Type.String({ minLength: 1 }),
    role: Role,
    externalId: Type.String(),
    phone: Type.String(),
    email: Type.String(),
    locale: Type.String(),
    timezone: Type.String(),
    isActive: Type.Boolean(),
  }),
);

export function identityRoutes(identity: IdentityService): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.post(
      '/auth/login',
      { schema: { tags: ['auth'], body: Type.Object({ login: Type.String(), password: Type.String() }) } },
      async (req) => identity.login(req.body.login, req.body.password),
    );

    app.post('/auth/logout', { schema: { tags: ['auth'] } }, async (req, reply) => {
      const token = bearerToken(req);
      if (token) await identity.logout(token);
      return reply.status(204).send();
    });

    app.get('/me', { schema: { tags: ['auth'] } }, async (req) => identity.getUser(currentUser(req).id));

    app.get('/users', { schema: { tags: ['users'] } }, async (req) => {
      requireRole(req, 'admin', 'dispatcher');
      return identity.listUsers();
    });

    app.post('/users', { schema: { tags: ['users'], body: UserBody } }, async (req, reply) => {
      requireRole(req, 'admin');
      return reply.status(201).send(await identity.createUser(req.body));
    });

    app.patch(
      '/users/:id',
      { schema: { tags: ['users'], params: Type.Object({ id: Type.String({ format: 'uuid' }) }), body: UserPatch } },
      async (req) => {
        requireRole(req, 'admin');
        return identity.updateUser(req.params.id, req.body);
      },
    );
  };
}
