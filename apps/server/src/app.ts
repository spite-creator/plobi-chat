/**
 * Composition root: platform first, then modules. Each module gets only the
 * services it depends on; modules talk to each other through public services
 * and the event bus.
 */
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify from 'fastify';
import type { Config } from './platform/config.js';
import { runMigrations, type Database } from './platform/db.js';
import { EventBus } from './platform/event-bus.js';
import { installAuth, installErrorHandler } from './platform/http.js';
import { automataRoutes } from './modules/automata/routes.js';
import { catalogRoutes } from './modules/catalog/routes.js';
import { CatalogService } from './modules/catalog/service.js';
import { identityRoutes } from './modules/identity/routes.js';
import { IdentityService } from './modules/identity/service.js';
import { placeRoutes } from './modules/places/routes.js';
import { PlaceService } from './modules/places/service.js';
import { tripRoutes } from './modules/trips/routes.js';
import { TripService } from './modules/trips/service.js';

export const VERSION = '0.1.0';

export async function buildApp(config: Config, database: Database) {
  const app = Fastify({ logger: { level: config.logLevel } }).withTypeProvider<TypeBoxTypeProvider>();
  const { db } = database;

  await runMigrations(db);

  const bus = new EventBus((error, event) => app.log.error({ err: error, event }, 'domain event listener failed'));
  const identity = new IdentityService(db, config.sessionTtlHours);
  const catalog = new CatalogService(db, bus);
  const places = new PlaceService(db);
  const trips = new TripService(db, bus, catalog, places, identity);

  await catalog.seedSystemEntries();
  const admin = await identity.ensureBootstrapAdmin(config.bootstrapAdmin.login, config.bootstrapAdmin.password);
  if (admin.created) {
    app.log.warn(
      admin.password
        ? `First start: admin "${config.bootstrapAdmin.login}" created with password ${admin.password} — change it now`
        : `First start: admin "${config.bootstrapAdmin.login}" created`,
    );
  }

  installErrorHandler(app);
  installAuth(app, (token) => identity.authenticate(token));

  await app.register(swagger, {
    openapi: {
      info: { title: 'Plobi API', version: VERSION },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
      security: [{ bearer: [] }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  await app.register(
    async (api) => {
      api.get('/health', { schema: { tags: ['system'] } }, async () => ({ status: 'ok', version: VERSION }));
      api.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
      await api.register(identityRoutes(identity));
      await api.register(catalogRoutes(catalog));
      await api.register(placeRoutes(places));
      await api.register(tripRoutes(trips));
      await api.register(automataRoutes(catalog));
    },
    { prefix: '/api/v1' },
  );

  app.addHook('onClose', () => database.close());
  return app;
}
