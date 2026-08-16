import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'
import { listMessages } from '../repos/messages.js'

describe('approval routes', () => {
  let built: BuiltApp
  let pool: pg.Pool

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
    built = await buildApp({ databaseUrl: 'postgres://ta:ta@localhost:5432/ta_dev' })
  })
  afterEach(async () => {
    await built.app.close()
  })

  async function loginAs(username: string): Promise<string> {
    const res = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username } })
    return res.json().token as string
  }

  async function createProjectSession(token: string): Promise<string> {
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    return res.json().session.id as string
  }

  it('creates an approval with a card message', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '上线审批', description: '报销系统上线', approverId: 'u-bob' },
    })
    expect(res.statusCode).toBe(201)
    const { approval, cardMessage } = res.json()
    expect(approval.status).toBe('pending')
    expect(cardMessage.contentType).toBe('confirmation_card')
    expect(cardMessage.ref).toEqual({ kind: 'approval', id: approval.id })
    const messages = await listMessages(pool, sessionId, 0, 10)
    expect(messages.some((m) => m.contentType === 'confirmation_card')).toBe(true)
  })

  it('rejects a non-member approver', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '上线审批', approverId: 'u-carol' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an agent approver with 400 (AGENT_NOT_ALLOWED)', async () => {
    const alice = await loginAs('alice')
    // agent 先进会话成员，才能走到仓储层 AGENT_NOT_ALLOWED（而非「非成员」400）
    const sessionRes = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob', 'agent-ta-pm'] },
    })
    const sessionId = sessionRes.json().session.id as string
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '上线审批', approverId: 'agent-ta-pm' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('approver must be a human')
  })

  it('approver decides and the card updates', async () => {
    const alice = await loginAs('alice')
    const bob = await loginAs('bob')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '上线审批', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    const decided = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decide`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { decision: 'approved' },
    })
    expect(decided.statusCode).toBe(200)
    expect(decided.json().approval.status).toBe('approved')
    const messages = await listMessages(pool, sessionId, 0, 10)
    const card = messages.find((m) => m.contentType === 'confirmation_card')!
    expect(card.content).toContain('✅ 已通过')
  })

  it('non-approver decision returns 403', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '上线审批', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    const decided = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decide`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { decision: 'approved' },
    })
    expect(decided.statusCode).toBe(403)
  })

  it('returns 404 for an unknown approval', async () => {
    const bob = await loginAs('bob')
    const decided = await built.app.inject({
      method: 'POST',
      url: '/api/v1/approvals/00000000-0000-0000-0000-000000000000/decide',
      headers: { authorization: `Bearer ${bob}` },
      payload: { decision: 'approved' },
    })
    expect(decided.statusCode).toBe(404)
  })

  it('rejects a non-uuid approval id with 400', async () => {
    const bob = await loginAs('bob')
    const decided = await built.app.inject({
      method: 'POST',
      url: '/api/v1/approvals/not-a-uuid/decide',
      headers: { authorization: `Bearer ${bob}` },
      payload: { decision: 'approved' },
    })
    expect(decided.statusCode).toBe(400)
  })

  it('decided card contains the reason suffix', async () => {
    const alice = await loginAs('alice')
    const bob = await loginAs('bob')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '上线审批', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decide`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { decision: 'rejected', reason: '缺少测试报告' },
    })
    const messages = await listMessages(pool, sessionId, 0, 10)
    const card = messages.find((m) => m.contentType === 'confirmation_card')!
    expect(card.content).toContain('❌ 已驳回')
    expect(card.content).toContain('缺少测试报告')
  })

  it('creates a multi-node approval and advances via decide', async () => {
    const alice = await loginAs('alice')
    const sessionRes = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob', 'u-carol'] },
    })
    const sessionId = sessionRes.json().session.id as string
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: {
        title: '两级审批',
        nodes: [
          { mode: 'single', approverIds: ['u-bob'] },
          { mode: 'single', approverIds: ['u-carol'] },
        ],
      },
    })
    expect(res.statusCode).toBe(201)
    const { approval } = res.json()
    expect(approval.nodes).toHaveLength(2)
    expect(approval.currentNodeIndex).toBe(0)

    const bob = await loginAs('bob')
    const first = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approval.id}/decide`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { decision: 'approved' },
    })
    expect(first.statusCode).toBe(200)
    expect(first.json().approval.currentNodeIndex).toBe(1)

    const carol = await loginAs('carol')
    const second = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approval.id}/decide`,
      headers: { authorization: `Bearer ${carol}` },
      payload: { decision: 'approved' },
    })
    expect(second.statusCode).toBe(200)
    expect(second.json().approval.status).toBe('approved')
  })

  it('rejects agent approvers with 400', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: {
        title: 'agent 审批',
        nodes: [{ mode: 'single', approverIds: ['agent-ta-pm'] }],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('transfers the approval to another approver', async () => {
    const alice = await loginAs('alice')
    // S1：转办目标必须是会话成员，故会话需包含 u-carol
    const sessionRes = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob', 'u-carol'] },
    })
    const sessionId = sessionRes.json().session.id as string
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '转办', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    const bob = await loginAs('bob')
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/transfer`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { newApproverId: 'u-carol' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().approval.nodes[0].approverIds).toEqual(['u-carol'])
  })

  it('rejects transfer to a non-session member with 400 (S1)', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice) // 成员仅 u-bob
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '转办给非成员', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    const bob = await loginAs('bob')
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/transfer`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { newApproverId: 'u-carol' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('must be a member of the approval session')
  })

  it('rejects transfer to an agent with 400 (AGENT_NOT_ALLOWED)', async () => {
    const alice = await loginAs('alice')
    // agent 先进会话成员，才能走到仓储层 AGENT_NOT_ALLOWED（而非「非成员」400）
    const sessionRes = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob', 'agent-ta-pm'] },
    })
    const sessionId = sessionRes.json().session.id as string
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '转办给 agent', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    const bob = await loginAs('bob')
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/transfer`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { newApproverId: 'agent-ta-pm' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('approver must be a human')
  })

  it('returns for revision and resubmits', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '驳回修改', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    const bob = await loginAs('bob')
    const returned = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/return`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { reason: '请补充预算' },
    })
    expect(returned.statusCode).toBe(200)
    expect(returned.json().approval.status).toBe('returned')

    const resubmitted = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/resubmit`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(resubmitted.statusCode).toBe(200)
    expect(resubmitted.json().approval.version).toBe(2)
    expect(resubmitted.json().approval.status).toBe('pending')
  })

  it('cancels only by the creator', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '撤销', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    const bob = await loginAs('bob')
    const denied = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/cancel`,
      headers: { authorization: `Bearer ${bob}` },
    })
    // S4：NOT_OWNER 是权限错误 → 403（原 409）
    expect(denied.statusCode).toBe(403)
    const cancelled = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/cancel`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(cancelled.statusCode).toBe(200)
    expect(cancelled.json().approval.status).toBe('cancelled')
  })

  it('creator cannot cancel once the first node has votes (S6 → 409)', async () => {
    const alice = await loginAs('alice')
    const sessionRes = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob', 'u-carol'] },
    })
    const sessionId = sessionRes.json().session.id as string
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '会签撤销', nodes: [{ mode: 'all', approverIds: ['u-bob', 'u-carol'] }] },
    })
    const approvalId = created.json().approval.id as string
    const bob = await loginAs('bob')
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decide`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { decision: 'approved' },
    })
    const cancelled = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/cancel`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(cancelled.statusCode).toBe(409)
  })

  it('GET /api/v1/approvals/:id: member 200 with nodes, non-member 403, unknown 404', async () => {
    const alice = await loginAs('alice')
    const carol = await loginAs('carol')
    const sessionId = await createProjectSession(alice) // 成员仅 u-bob
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '查询', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    // 成员 → 200 且 { approval } 含 nodes
    const member = await built.app.inject({
      method: 'GET',
      url: `/api/v1/approvals/${approvalId}`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(member.statusCode).toBe(200)
    expect(member.json().approval.id).toBe(approvalId)
    expect(member.json().approval.nodes).toHaveLength(1)
    // 非成员 → 403
    const nonMember = await built.app.inject({
      method: 'GET',
      url: `/api/v1/approvals/${approvalId}`,
      headers: { authorization: `Bearer ${carol}` },
    })
    expect(nonMember.statusCode).toBe(403)
    // 不存在 → 404
    const missing = await built.app.inject({
      method: 'GET',
      url: '/api/v1/approvals/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(missing.statusCode).toBe(404)
  })
})
