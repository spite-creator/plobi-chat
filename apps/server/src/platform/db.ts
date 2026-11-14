/**
 * Database access: one pool, a typed Drizzle client, migrations on startup.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
/** A transaction has the same API as the database client. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface Database {
  readonly db: Db;
  readonly close: () => Promise<void>;
}

export function connect(databaseUrl: string): Database {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

const defaultMigrationsDir = () =>
  process.env['MIGRATIONS_DIR'] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/** Migrations only go forward; each is a numbered SQL file in /drizzle. */
export async function runMigrations(db: Db, migrationsFolder = defaultMigrationsDir()): Promise<void> {
  await migrate(db, { migrationsFolder });
}
