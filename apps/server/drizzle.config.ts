import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  // Module schema files directly: they import nothing relative, which drizzle-kit's loader needs.
  schema: './src/modules/*/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env['DATABASE_URL'] ?? 'postgres://plobi:plobi@localhost:5432/plobi' },
});
