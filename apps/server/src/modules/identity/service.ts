/**
 * Users, passwords and sessions.
 *
 * Sessions are opaque random tokens sent as `Authorization: Bearer`, not
 * cookies, so a session works through any mirror address. Only the token
 * hash is stored.
 */
import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { conflict, notFound, unauthorized } from '../../platform/errors.js';
import type { Db } from '../../platform/db.js';
import { sessions, users, type UserRole } from './schema.js';

export interface AuthUser {
  readonly id: string;
  readonly role: UserRole;
  readonly name: string;
}

export interface UserView {
  id: string;
  externalId: string | null;
  login: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  locale: string;
  timezone: string;
}

export interface NewUser {
  login: string;
  password: string;
  name: string;
  role: UserRole;
  externalId?: string;
  phone?: string;
  email?: string;
  locale?: string;
  timezone?: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const view = (u: typeof users.$inferSelect): UserView => ({
  id: u.id,
  externalId: u.externalId,
  login: u.login,
  name: u.name,
  phone: u.phone,
  email: u.email,
  role: u.role,
  isActive: u.isActive,
  locale: u.locale,
  timezone: u.timezone,
});

export class IdentityService {
  constructor(
    private readonly db: Db,
    private readonly sessionTtlHours: number,
  ) {}

  async login(login: string, password: string): Promise<{ token: string; user: UserView }> {
    const [user] = await this.db.select().from(users).where(eq(users.login, login));
    // Same error for unknown login and wrong password: do not reveal which logins exist.
    if (!user || !user.isActive || !(await verify(user.passwordHash, password))) {
      throw unauthorized('Wrong login or password');
    }
    const token = randomBytes(32).toString('base64url');
    await this.db.insert(sessions).values({
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + this.sessionTtlHours * 3_600_000),
    });
    return { token, user: view(user) };
  }

  async logout(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  }

  /** Resolves a bearer token to its user, or undefined. */
  async authenticate(token: string): Promise<AuthUser | undefined> {
    const [row] = await this.db
      .select({ id: users.id, role: users.role, name: users.name, isActive: users.isActive })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
    if (!row || !row.isActive) return undefined;
    return { id: row.id, role: row.role, name: row.name };
  }

  async createUser(input: NewUser): Promise<UserView> {
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.login, input.login));
    if (existing) throw conflict('login_taken', `Login ${input.login} is already taken`);
    const { password, ...rest } = input;
    const [created] = await this.db
      .insert(users)
      .values({ ...rest, passwordHash: await hash(password) })
      .returning();
    return view(created as typeof users.$inferSelect);
  }

  async updateUser(
    id: string,
    patch: Partial<Omit<NewUser, 'login'>> & { isActive?: boolean },
  ): Promise<UserView> {
    const { password, ...rest } = patch;
    const values = { ...rest, ...(password ? { passwordHash: await hash(password) } : {}) };
    const [updated] = await this.db.update(users).set(values).where(eq(users.id, id)).returning();
    if (!updated) throw notFound('User', id);
    if (patch.isActive === false || password) await this.db.delete(sessions).where(eq(sessions.userId, id));
    return view(updated);
  }

  async listUsers(): Promise<UserView[]> {
    return (await this.db.select().from(users).orderBy(asc(users.name))).map(view);
  }

  /** Resolves a reference by our id or by the id in the client's own system. */
  async findUser(ref: { id: string } | { externalId: string }): Promise<UserView> {
    const [user] = await this.db
      .select()
      .from(users)
      .where('id' in ref ? eq(users.id, ref.id) : eq(users.externalId, ref.externalId));
    if (!user) throw notFound('User', 'id' in ref ? ref.id : `external ${ref.externalId}`);
    return view(user);
  }

  async getUser(id: string): Promise<UserView> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    if (!user) throw notFound('User', id);
    return view(user);
  }

  /**
   * First start: create the admin. If no password is configured, a random one
   * is generated and returned so it can be printed once to the log.
   */
  async ensureBootstrapAdmin(login: string, password?: string): Promise<{ created: boolean; password?: string }> {
    const [{ count } = { count: 0 }] = await this.db.select({ count: sql<number>`count(*)::int` }).from(users);
    if (count > 0) return { created: false };
    const generated = password ?? randomBytes(12).toString('base64url');
    await this.createUser({ login, password: generated, name: 'Administrator', role: 'admin' });
    return { created: true, ...(password ? {} : { password: generated }) };
  }
}
