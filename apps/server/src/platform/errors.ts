/**
 * Typed domain errors. Modules throw them; the HTTP layer maps them to
 * responses with a stable `code` that clients and integrations rely on.
 */

export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string, id: string) => new DomainError('not_found', 404, `${what} ${id} not found`);

export const forbidden = (message = 'Not allowed') => new DomainError('forbidden', 403, message);

export const unauthorized = (message = 'Authentication required') => new DomainError('unauthorized', 401, message);

export const badRequest = (code: string, message: string, details?: unknown) =>
  new DomainError(code, 400, message, details);

export const conflict = (code: string, message: string, details?: unknown) =>
  new DomainError(code, 409, message, details);
