import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from './repos/test-helpers.js'
import { createApproval, escalateOverdueApprovals } from './repos/approvals.js'
import { runEscalationTick } from './scheduler.js'

describe('scheduler', () => {
  let pool: pg.Pool
  let sessionId: string

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
    // 建真实会话（审批 FK 需要）
    const session = await pool.query<{ id: string }>(
      `INSERT INTO sessions (kind, title, tenant_id) VALUES ('project', '调度测试', '00000000-0000-0000-0000-000000000001') RETURNING id`,
    )
    sessionId = session.rows[0]!.id
    // 适配：escalateOverdueApprovals 无 admin 用户时提前返回 []（与 approvals.test.ts 同模式）——升级目标审批人
    await pool.query(`INSERT INTO users (user_id, name, role) VALUES ('u-probe', 'Probe', 'admin')`)
  })
  afterEach(async () => {
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 24 WHERE id = 1`)
  })

  it('escalates overdue approvals via tick', async () => {
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 0 WHERE id = 1`)
    await createApproval(pool, {
      sessionId,
      title: '超时自动升级',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    const count = await runEscalationTick(pool, new Date(Date.now() + 1000))
    expect(count).toBeGreaterThanOrEqual(1)
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 24 WHERE id = 1`)
  })

  it('does not escalate fresh approvals', async () => {
    await createApproval(pool, {
      sessionId,
      title: '未超时',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    const count = await runEscalationTick(pool)
    expect(count).toBe(0)
  })
})
