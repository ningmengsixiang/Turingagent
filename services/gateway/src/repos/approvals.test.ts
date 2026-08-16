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
  escalateOverdueApprovals,
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

  it('refuses to cancel once the first node has votes; cancels when unvoted (S6)', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '会签撤销',
      createdBy: 'u-alice',
      nodes: [{ mode: 'all', approverIds: ['u-bob', 'u-carol'] }],
    })
    // 会签首票（未齐票仍 pending）后发起人不可撤销
    await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })
    await expect(cancelApproval(pool, { id: created.id, operatorId: 'u-alice' })).rejects.toMatchObject({
      code: 'NOT_PENDING',
    })
    // 未投票时撤销 → cancelled
    const fresh = await createApproval(pool, {
      sessionId,
      title: '直接撤销',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    const cancelled = await cancelApproval(pool, { id: fresh.id, operatorId: 'u-alice' })
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

  it('countersign (all) aggregates mixed votes: any reject makes the whole flow rejected', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '三人会签混合票',
      createdBy: 'u-alice',
      nodes: [{ mode: 'all', approverIds: ['u-bob', 'u-carol', 'u-dave'] }],
    })
    const v1 = await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })
    expect(v1.status).toBe('pending')
    const v2 = await decideApproval(pool, { id: created.id, approverId: 'u-carol', decision: 'rejected' })
    expect(v2.status).toBe('pending') // 会签不早停：未齐票
    const v3 = await decideApproval(pool, { id: created.id, approverId: 'u-dave', decision: 'approved' })
    expect(v3.status).toBe('rejected') // 齐票聚合：任一驳回 → 整体 rejected
  })

  it('or-sign (any) stays pending after a reject and approves on a later approve', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '或签先拒后过',
      createdBy: 'u-alice',
      nodes: [{ mode: 'any', approverIds: ['u-bob', 'u-carol'] }],
    })
    const r1 = await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'rejected' })
    expect(r1.status).toBe('pending')
    const r2 = await decideApproval(pool, { id: created.id, approverId: 'u-carol', decision: 'approved' })
    expect(r2.status).toBe('approved')
  })

  it('refuses to decide after cancel', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '撤销后裁决',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    await cancelApproval(pool, { id: created.id, operatorId: 'u-alice' })
    await expect(
      decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' }),
    ).rejects.toMatchObject({ code: 'NOT_PENDING' })
  })

  it('refuses to decide after return', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '退回后裁决',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    await returnApproval(pool, { id: created.id, operatorId: 'u-bob', reason: '请补充预算' })
    await expect(
      decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' }),
    ).rejects.toMatchObject({ code: 'NOT_PENDING' })
  })

  it('lets a v1 voter decide again in version 2 after return + resubmit', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '重提重走',
      createdBy: 'u-alice',
      nodes: [{ mode: 'all', approverIds: ['u-bob', 'u-carol'] }],
    })
    // 版本 1：bob 已投 approved（会签未齐票，节点仍 pending），carol 退回
    await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })
    await returnApproval(pool, { id: created.id, operatorId: 'u-carol', reason: '请补充预算' })
    await resubmitApproval(pool, { id: created.id, operatorId: 'u-alice' })
    // 版本 2：投票重置，bob 可重新裁决
    const v2 = await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })
    expect(v2.status).toBe('pending')
    expect(v2.version).toBe(2)
    const decided = await decideApproval(pool, { id: created.id, approverId: 'u-carol', decision: 'approved' })
    expect(decided.status).toBe('approved')
    expect(decided.version).toBe(2)
  })

  it('lets the new approver decide after transfer', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '转办后裁决',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    await transferApproval(pool, { id: created.id, operatorId: 'u-bob', newApproverId: 'u-carol' })
    const decided = await decideApproval(pool, { id: created.id, approverId: 'u-carol', decision: 'approved' })
    expect(decided.status).toBe('approved')
    expect(decided.approverId).toBe('u-carol')
  })

  it('dedupes duplicate approver ids so one person still votes once (会签一人一票)', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '审批人去重',
      createdBy: 'u-alice',
      nodes: [{ mode: 'all', approverIds: ['u-bob', 'u-bob'] }],
    })
    expect(created.nodes[0]!.approverIds).toEqual(['u-bob']) // 去重后单席位
    const decided = await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })
    expect(decided.status).toBe('approved') // 一人一票即齐票推进
  })

  it('escalates an overdue approval to an admin', async () => {
    // users 表被 truncateAll 清空：先插入 admin（升级目标审批人）
    await pool.query(`INSERT INTO users (user_id, name, role) VALUES ('u-probe', 'Probe', 'admin')`)
    // 把超时配置调为 0（立即超时）
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 0 WHERE id = 1`)
    const created = await createApproval(pool, {
      sessionId,
      title: '超时升级',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    const escalated = await escalateOverdueApprovals(pool, new Date(Date.now() + 1000))
    const mine = escalated.find((a) => a.id === created.id)
    expect(mine).toBeTruthy()
    expect(mine!.escalatedCount).toBe(1)
    // 原审批人失效：u-bob 不再是 approver
    expect(mine!.nodes[0]!.approverIds).not.toContain('u-bob')
    // 升级后审批人是 admin（u-probe）
    expect(mine!.nodes[0]!.approverIds.length).toBe(1)
    // 恢复配置
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 24 WHERE id = 1`)
  })

  it('does not escalate a fresh pending approval', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '未超时',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    const escalated = await escalateOverdueApprovals(pool, new Date())
    expect(escalated.find((a) => a.id === created.id)).toBeUndefined()
  })

  it('advancing a node resets the activation time', async () => {
    // users 表被 truncateAll 清空：插入 admin（否则 escalate 因无 admin 提前返回，无法验证重置）
    await pool.query(`INSERT INTO users (user_id, name, role) VALUES ('u-probe', 'Probe', 'admin')`)
    // 超时阈值调为 1h，并把激活时间回拨 2h → 推进前已超时
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 1 WHERE id = 1`)
    const created = await createApproval(pool, {
      sessionId,
      title: '推进重置',
      createdBy: 'u-alice',
      nodes: [
        { mode: 'single', approverIds: ['u-bob'] },
        { mode: 'single', approverIds: ['u-bob'] },
      ],
    })
    await pool.query(`UPDATE approvals SET last_node_activated_at = now() - interval '2 hours' WHERE id = $1`, [
      created.id,
    ])
    await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })
    // 推进后激活时间重置为 now：超时扫描（now）不应判其超时
    const escalated = await escalateOverdueApprovals(pool, new Date())
    expect(escalated.find((a) => a.id === created.id)).toBeUndefined()
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 24 WHERE id = 1`)
  })
})
