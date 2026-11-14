# Plobi application image. The database runs in its own container (see docker-compose.yml).
# NODE_IMAGE can point to a registry mirror where Docker Hub is unavailable.
ARG NODE_IMAGE=node:22.20-slim

# ---- build: install the workspace and make the production bundle ----
FROM ${NODE_IMAGE} AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile
COPY packages/core packages/core
COPY apps/server apps/server
RUN cd apps/server && node build.mjs

# ---- runtime: the bundle, migrations and the few packages that need files on disk ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
RUN npm install --omit=dev --no-save --no-package-lock @node-rs/argon2@2.2.2 @fastify/swagger-ui@6.1.2
COPY --from=build /src/apps/server/dist ./dist
COPY --from=build /src/apps/server/drizzle ./drizzle
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
