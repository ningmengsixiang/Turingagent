import pg from 'pg'
import { runMigrations } from '../migrate.js'

export const TEST_DATABASE_URL = 'postgres://ta:ta@localhost:5432/ta_dev'

export async function createTestPool(): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 5 })
  await runMigrations(pool)
  return pool
}

export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query('TRUNCATE messages, session_members, sessions, users, audit_events RESTART IDENTITY CASCADE')
}
