import pg from 'pg'
import { runMigrations } from '../migrate.js'

export const TEST_DATABASE_URL = 'postgres://ta:ta@localhost:5432/ta_dev'

export async function createTestPool(): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 5 })
  await runMigrations(pool)
  return pool
}

export async function truncateAll(pool: pg.Pool): Promise<void> {
  // 注意：quota_config 不 truncate——迁移 009 插入的默认预算行（1000000）须保留，
  // 熔断用例依赖它存在（调额端点 UPDATE 命中该行）；agent_usage 每次清空（用量从零计量）
  await pool.query('TRUNCATE messages, session_members, sessions, users, audit_events, memories, memory_versions, tasks, agent_usage RESTART IDENTITY CASCADE')
}
