import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from './test-helpers.js'
import { recordAudit, listAudit } from './audit.js'

describe('audit repository', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
  })

  it('records and lists audit events newest first', async () => {
    await recordAudit(pool, { actorId: 'u-alice', action: 'approval.decided', target: 'a1', detail: { status: 'approved' } })
    await recordAudit(pool, { actorId: 'u-alice', action: 'role.changed', target: 'u-bob', detail: { from: 'member', to: 'admin' } })
    const events = await listAudit(pool, 10)
    expect(events).toHaveLength(2)
    expect(events[0]!.action).toBe('role.changed') // 最新在前
    expect(events[0]!.target).toBe('u-bob')
    expect(events[0]!.detail).toEqual({ from: 'member', to: 'admin' })
  })

  it('respects the limit', async () => {
    for (let i = 0; i < 5; i++) {
      await recordAudit(pool, { actorId: 'u-alice', action: 'login' })
    }
    const events = await listAudit(pool, 2)
    expect(events).toHaveLength(2)
  })
})
