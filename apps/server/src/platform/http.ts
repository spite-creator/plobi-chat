/**
 * HTTP platform: error mapping and authentication helpers shared by all modules.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '../modules/identity/service.js';
import type { UserRole } from '../modules/identity/schema.js';
import { DomainError, forbidden, unauthorized } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export type Authenticate = (token: string) => Promise<AuthUser | undefined>;

export function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

/** Resolves the bearer token on every request; routes decide whether a user is required. */
export function installAuth(app: FastifyInstance, authenticate: Authenticate): void {
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    const token = bearerToken(request);
    if (token) {
      const user = await authenticate(token);
      if (user) request.user = user;
    }
  });
}

/** The signed-in user, or 401. */
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw unauthorized();
  return request.user;
}

/** The signed-in user with one of the roles, or 401 / 403. */
export function requireRole(request: FastifyRequest, ...roles: UserRole[]): AuthUser {
  const user = currentUser(request);
  if (!roles.includes(user.role)) throw forbidden(`Requires role: ${roles.join(', ')}`);
  return user;
}

/** Domain errors and validation errors become `{ code, message, details }`. */
export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply: FastifyReply) => {
    if (error instanceof DomainError) {
      return reply.status(error.status).send({ code: error.code, message: error.message, details: error.details });
    }
    const e = error as { validation?: unknown; statusCode?: number; message?: string };
    if (e.validation) {
      return reply.status(400).send({ code: 'invalid_request', message: e.message, details: e.validation });
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ code: 'invalid_request', message: e.message });
    }
    request.log.error(error);
    return reply.status(500).send({ code: 'internal', message: 'Internal server error' });
  });
}
