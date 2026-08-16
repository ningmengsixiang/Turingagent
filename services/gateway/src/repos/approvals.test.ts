import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from './test-helpers.js'
import { createSession } from './sessions.js'
import {
  createApproval,
  decideApproval,
  transferApproval,
  returnApproval,
  resubmitApproval,
  cancelApproval,
  ApprovalStateError,
  getApproval,
} from './approvals.js'

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

  it('advances through serial single nodes to approved', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '两级串行',
      createdBy: 'u-alice',
      nodes: [
        { mode: 'single', approverIds: ['u-bob'] },
        { mode: 'single', approverIds: ['u-carol'] },
      ],
    })
    expect(created.status).toBe('pending')
    expect(created.currentNodeIndex).toBe(0)
    expect(created.nodes).toHaveLength(2)

    const afterFirst = await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })
    expect(afterFirst.status).toBe('pending')
    expect(afterFirst.currentNodeIndex).toBe(1)
    expect(afterFirst.nodes[0]!.status).toBe('approved')

    const afterSecond = await decideApproval(pool, { id: created.id, approverId: 'u-carol', decision: 'approved' })
    expect(afterSecond.status).toBe('approved')
    expect(afterSecond.nodes[1]!.status).toBe('approved')
  })

  it('rejects the whole flow when a single node rejects', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '串行驳回',
      createdBy: 'u-alice',
      nodes: [
        { mode: 'single', approverIds: ['u-bob'] },
        { mode: 'single', approverIds: ['u-carol'] },
      ],
    })
    const after = await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'rejected', reason: '方案不可行' })
    expect(after.status).toBe('rejected')
    expect(after.reason).toBe('方案不可行')
  })

  it('countersign (all) needs every approver and rejects on any reject', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '会签',
      createdBy: 'u-alice',
      nodes: [{ mode: 'all', approverIds: ['u-bob', 'u-carol'] }],
    })
    const oneVote = await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })
    expect(oneVote.status).toBe('pending') // 未齐票不推进

    const rejected = await decideApproval(pool, { id: created.id, approverId: 'u-carol', decision: 'rejected' })
    expect(rejected.status).toBe('rejected')
  })

  it('or-sign (any) approves on first approval and rejects only when all reject', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '或签',
      createdBy: 'u-alice',
      nodes: [{ mode: 'any', approverIds: ['u-bob', 'u-carol'] }],
    })
    const approved = await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })
    expect(approved.status).toBe('approved')

    const created2 = await createApproval(pool, {
      sessionId,
      title: '或签全拒',
      createdBy: 'u-alice',
      nodes: [{ mode: 'any', approverIds: ['u-bob', 'u-carol'] }],
    })
    const r1 = await decideApproval(pool, { id: created2.id, approverId: 'u-bob', decision: 'rejected' })
    expect(r1.status).toBe('pending')
    const r2 = await decideApproval(pool, { id: created2.id, approverId: 'u-carol', decision: 'rejected' })
    expect(r2.status).toBe('rejected')
  })

  it('rejects double voting by the same approver', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '重复投票',
      createdBy: 'u-alice',
      nodes: [{ mode: 'all', approverIds: ['u-bob', 'u-carol'] }],
    })
    await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })
    await expect(decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })).rejects.toMatchObject({
      code: 'ALREADY_DECIDED',
    })
  })

  it('transfers the current node approver', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '转办',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    const transferred = await transferApproval(pool, { id: created.id, operatorId: 'u-bob', newApproverId: 'u-carol' })
    expect(transferred.nodes[0]!.approverIds).toEqual(['u-carol'])
    // 原审批人不再能裁决
    await expect(decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })).rejects.toMatchObject({
      code: 'NOT_APPROVER',
    })
  })

  it('returns for revision and resubmits with version +1', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '驳回修改',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    const returned = await returnApproval(pool, { id: created.id, operatorId: 'u-bob', reason: '请补充预算' })
    expect(returned.status).toBe('returned')

    const resubmitted = await resubmitApproval(pool, { id: created.id, operatorId: 'u-alice' })
    expect(resubmitted.status).toBe('pending')
    expect(resubmitted.version).toBe(2)
    expect(resubmitted.currentNodeIndex).toBe(0)
  })

  it('cancels only by the creator while pending', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '撤销',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    await expect(cancelApproval(pool, { id: created.id, operatorId: 'u-bob' })).rejects.toMatchObject({ code: 'NOT_OWNER' })
    const cancelled = await cancelApproval(pool, { id: created.id, operatorId: 'u-alice' })
    expect(cancelled.status).toBe('cancelled')
  })

  it('rejects agent approvers', async () => {
    await expect(
      createApproval(pool, {
        sessionId,
        title: 'agent 审批',
        createdBy: 'u-alice',
        nodes: [{ mode: 'single', approverIds: ['agent-ta-pm'] }],
      }),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_ALLOWED' })
  })
})
