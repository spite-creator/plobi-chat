import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const USER_ROLES = ['admin', 'dispatcher', 'driver', 'observer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: text('external_id').unique(),
  login: text('login').notNull().unique(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  role: text('role', { enum: USER_ROLES }).notNull(),
  passwordHash: text('password_hash').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  locale: text('locale').notNull().default('ru'),
  timezone: text('timezone').notNull().default('UTC'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Opaque bearer tokens; only their SHA-256 is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);
