import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { connect } from '../src/platform/db.js';

export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? 'postgres://plobi:plobi@localhost:5432/plobi_test';
export const ADMIN = { login: 'admin', password: 'admin-password' };

type App = Awaited<ReturnType<typeof buildApp>>;

/** A fresh app on an empty database: migrations, base catalog and admin are created like on first start. */
export async function startApp(): Promise<Api> {
  const reset = connect(TEST_DATABASE_URL);
  await reset.db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`);
  await reset.close();

  const app = await buildApp(
    {
      port: 0,
      host: '127.0.0.1',
      databaseUrl: TEST_DATABASE_URL,
      sessionTtlHours: 1,
      bootstrapAdmin: ADMIN,
      logLevel: 'silent',
    },
    connect(TEST_DATABASE_URL),
  );
  const api = new Api(app);
  api.token = await api.login(ADMIN.login, ADMIN.password);
  return api;
}

export interface Reply<T = any> {
  status: number;
  body: T;
}

/** Thin client over app.inject, acting as one signed-in user. */
export class Api {
  token?: string;
  constructor(readonly app: App) {}

  as(token: string): Api {
    const other = new Api(this.app);
    other.token = token;
    return other;
  }

  async request<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown): Promise<Reply<T>> {
    const res = await this.app.inject({
      method,
      url: `/api/v1${url}`,
      ...(payload !== undefined ? { payload: payload as object } : {}),
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
    });
    return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
  }

  get = <T = any>(url: string) => this.request<T>('GET', url);
  post = <T = any>(url: string, body?: unknown) => this.request<T>('POST', url, body ?? {});
  put = <T = any>(url: string, body: unknown) => this.request<T>('PUT', url, body);
  patch = <T = any>(url: string, body: unknown) => this.request<T>('PATCH', url, body);

  async login(login: string, password: string): Promise<string> {
    const res = await this.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { login, password } });
    if (res.statusCode !== 200) throw new Error(`login ${login} failed: ${res.body}`);
    return res.json().token;
  }

  /** Creates a user (as admin) and returns an Api acting as them. */
  async user(role: 'driver' | 'dispatcher' | 'observer', login = `${role}-${randomUUID().slice(0, 6)}`) {
    const created = await this.post('/users', { login, password: 'password-123', name: login, role });
    if (created.status !== 201) throw new Error(JSON.stringify(created.body));
    return { id: created.body.id as string, api: this.as(await this.login(login, 'password-123')) };
  }
}

let clock = Date.parse('2026-11-20T06:00:00Z');
/** Event times move forward 10 minutes per call. */
export const nextTime = () => new Date((clock += 10 * 60_000)).toISOString();
export const eventId = () => randomUUID();
