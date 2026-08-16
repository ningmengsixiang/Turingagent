import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from './test-helpers.js'
import { createSession } from './sessions.js'
import { createApproval, decideApproval, ApprovalStateError, getApproval } from './approvals.js'

describe('approval repository', () => {
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
    const session = await createSession(pool, { kind: 'project', title: '报销系统', memberIds: ['u-alice', 'u-bob'] })
    sessionId = session.id
  })

  it('creates a pending approval', async () => {
    const approval = await createApproval(pool, {
      sessionId,
      title: '上线审批',
      description: '报销系统上线',
      approverId: 'u-bob',
      createdBy: 'u-alice',
    })
    expect(approval.status).toBe('pending')
    expect(approval.approverId).toBe('u-bob')
    expect(approval.createdBy).toBe('u-alice')
  })

  it('approves a pending approval', async () => {
    const approval = await createApproval(pool, {
      sessionId,
      title: '上线审批',
      approverId: 'u-bob',
      createdBy: 'u-alice',
    })
    const decided = await decideApproval(pool, { id: approval.id, approverId: 'u-bob', decision: 'approved' })
    expect(decided.status).toBe('approved')
    expect(decided.decidedAt).toBeTruthy()
  })

  it('rejects with a reason', async () => {
    const approval = await createApproval(pool, {
      sessionId,
      title: '上线审批',
      approverId: 'u-bob',
      createdBy: 'u-alice',
    })
    const decided = await decideApproval(pool, { id: approval.id, approverId: 'u-bob', decision: 'rejected', reason: '缺少测试报告' })
    expect(decided.status).toBe('rejected')
    expect(decided.reason).toBe('缺少测试报告')
  })

  it('refuses to decide twice', async () => {
    const approval = await createApproval(pool, {
      sessionId,
      title: '上线审批',
      approverId: 'u-bob',
      createdBy: 'u-alice',
    })
    await decideApproval(pool, { id: approval.id, approverId: 'u-bob', decision: 'approved' })
    await expect(decideApproval(pool, { id: approval.id, approverId: 'u-bob', decision: 'rejected' })).rejects.toThrow(
      ApprovalStateError,
    )
  })

  it('refuses a non-approver decision', async () => {
    const approval = await createApproval(pool, {
      sessionId,
      title: '上线审批',
      approverId: 'u-bob',
      createdBy: 'u-alice',
    })
    await expect(decideApproval(pool, { id: approval.id, approverId: 'u-alice', decision: 'approved' })).rejects.toThrow(
      ApprovalStateError,
    )
  })

  it('refuses unknown approval', async () => {
    await expect(
      decideApproval(pool, { id: '00000000-0000-0000-0000-000000000000', approverId: 'u-bob', decision: 'approved' }),
    ).rejects.toThrow(ApprovalStateError)
  })

  it('decides exactly once under concurrent decisions (并发回归)', async () => {
    const approval = await createApproval(pool, {
      sessionId,
      title: '上线审批',
      approverId: 'u-bob',
      createdBy: 'u-alice',
    })
    const results = await Promise.allSettled([
      decideApproval(pool, { id: approval.id, approverId: 'u-bob', decision: 'approved' }),
      decideApproval(pool, { id: approval.id, approverId: 'u-bob', decision: 'rejected' }),
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1) // 恰一次决策成功
    expect(rejected).toHaveLength(1) // 另一路被拒（AlreadyDecided）
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ApprovalStateError)
    }
    const final = await getApproval(pool, approval.id)
    expect(final?.status).not.toBe('pending') // 终态：approved 或 rejected
  })
})
