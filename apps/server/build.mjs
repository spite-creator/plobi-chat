// Production bundle: one ESM file with the core and all pure-JS dependencies.
// Packages that need files on disk at runtime (native binaries, static assets)
// stay external and are installed in the image.
import { build } from 'esbuild';

export const RUNTIME_PACKAGES = ['@node-rs/argon2', '@fastify/swagger-ui'];

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: [...RUNTIME_PACKAGES, 'pg-native'],
  // Some bundled CommonJS dependencies call require().
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
