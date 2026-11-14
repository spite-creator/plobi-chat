/**
 * Configuration from environment variables. Read once at startup.
 */

export interface Config {
  readonly port: number;
  readonly host: string;
  readonly databaseUrl: string;
  /** Session lifetime, hours. */
  readonly sessionTtlHours: number;
  /** First admin, created only when there are no users yet. */
  readonly bootstrapAdmin: { readonly login: string; readonly password?: string };
  readonly logLevel: string;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  return {
    port: int('PORT', 8080),
    host: env['HOST'] ?? '0.0.0.0',
    databaseUrl,
    sessionTtlHours: int('SESSION_TTL_HOURS', 24 * 30),
    bootstrapAdmin: {
      login: env['ADMIN_LOGIN'] ?? 'admin',
      ...(env['ADMIN_PASSWORD'] ? { password: env['ADMIN_PASSWORD'] } : {}),
    },
    logLevel: env['LOG_LEVEL'] ?? 'info',
  };
}
