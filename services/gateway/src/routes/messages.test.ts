import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('message routes', () => {
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

  it('sends and lists messages with seq order', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const first = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'm1', contentType: 'text', content: '第一条' },
    })
    expect(first.statusCode).toBe(201)
    expect(first.json().message.seq).toBe(1)
    const second = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'm2', contentType: 'text', content: '第二条' },
    })
    expect(second.json().message.seq).toBe(2)
    const list = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().messages).toHaveLength(2)
  })

  it('replays the same message on duplicate clientMsgId (200)', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const payload = { clientMsgId: 'dup', contentType: 'text', content: '唯一' }
    const first = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload,
    })
    const second = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload,
    })
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(200)
    expect(second.json().message.id).toBe(first.json().message.id)
  })

  it('rejects invalid content types', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'x', contentType: 'carrier-pigeon', content: 'hi' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('denies non-member sending', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const carol = await loginAs('carol')
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${carol}` },
      payload: { clientMsgId: 'x', contentType: 'text', content: '侵入' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('marks read', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'm1', contentType: 'text', content: '第一条' },
    })
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/read`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { seq: 1 },
    })
    expect(res.statusCode).toBe(204)
  })

  it('sends a message replying to another', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const first = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'm1', contentType: 'text', content: '被引用的消息' },
    })
    const firstId = first.json().message.id as string
    const second = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'm2', contentType: 'text', content: '引用回复', replyTo: firstId },
    })
    expect(second.statusCode).toBe(201)
    expect(second.json().message.replyTo).toBe(firstId)
    const list = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
    })
    const reply = list.json().messages.find((m: { replyTo?: string }) => m.replyTo === firstId)
    expect(reply.replyPreview).toContain('被引用的消息')
  })

  it('rejects replying to a nonexistent message with 400', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'm2', contentType: 'text', content: '引用不存在', replyTo: '00000000-0000-0000-0000-000000000000' },
    })
    expect(res.statusCode).toBe(400)
  })
})
