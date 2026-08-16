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
})
