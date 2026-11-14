import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { currentUser, requireRole } from '../../platform/http.js';
import { CATALOG_KINDS } from './schema.js';
import type { CatalogService } from './service.js';

const Kind = Type.Union(CATALOG_KINDS.map((k) => Type.Literal(k)));
const ItemParams = Type.Object({ kind: Kind, code: Type.String({ minLength: 1 }) });

export function catalogRoutes(catalog: CatalogService): FastifyPluginAsyncTypebox {
  return async (app) => {
    /** The assembled catalog, as the apps and the engine use it. */
    app.get('/catalog', { schema: { tags: ['catalog'] } }, async (req) => {
      currentUser(req);
      return catalog.get();
    });

    app.get(
      '/catalog/items',
      { schema: { tags: ['catalog'], querystring: Type.Object({ kind: Type.Optional(Kind) }) } },
      async (req) => {
        requireRole(req, 'admin', 'dispatcher');
        return catalog.listItems(req.query.kind);
      },
    );

    app.get('/catalog/issues', { schema: { tags: ['catalog'] } }, async (req) => {
      requireRole(req, 'admin', 'dispatcher');
      return catalog.issues();
    });

    app.put(
      '/catalog/items/:kind/:code',
      { schema: { tags: ['catalog'], params: ItemParams, body: Type.Record(Type.String(), Type.Unknown()) } },
      async (req) => {
        requireRole(req, 'admin');
        return { issues: await catalog.upsertItem(req.params.kind, req.params.code, req.body) };
      },
    );

    app.post(
      '/catalog/items/:kind/:code/hide',
      { schema: { tags: ['catalog'], params: ItemParams, body: Type.Object({ hidden: Type.Boolean() }) } },
      async (req) => {
        requireRole(req, 'admin');
        return { issues: await catalog.setHidden(req.params.kind, req.params.code, req.body.hidden) };
      },
    );
  };
}
