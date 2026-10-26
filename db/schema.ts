import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Only hashes and encrypted Google credentials are stored. No portfolio snapshots.
export const googleSessions = sqliteTable('google_sessions', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const googleStates = sqliteTable('google_states', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const priceJobs = sqliteTable('price_jobs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  payload: text('payload'),
  expiresAt: integer('expires_at').notNull(),
});
export const priceLocks = sqliteTable('price_locks', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
