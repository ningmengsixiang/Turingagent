import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('session routes', () => {
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

  it('creates a session as a member', async () => {
    const token = await loginAs('alice')
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    expect(res.statusCode).toBe(201)
    const { session } = res.json()
    expect(session.kind).toBe('project')
    expect(session.memberIds).toContain('u-alice')
    expect(session.memberIds).toContain('u-bob')
  })

  it('requires auth', async () => {
    const res = await built.app.inject({ method: 'GET', url: '/api/v1/sessions' })
    expect(res.statusCode).toBe(401)
  })

  it('lists only my sessions', async () => {
    const alice = await loginAs('alice')
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '我的项目', memberIds: ['u-alice'] },
    })
    expect(created.statusCode).toBe(201)
    const aliceList = await built.app.inject({
      method: 'GET',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(aliceList.json().sessions).toHaveLength(1)
    const bob = await loginAs('bob')
    const bobList = await built.app.inject({
      method: 'GET',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${bob}` },
    })
    expect(bobList.statusCode).toBe(200)
    expect(bobList.json().sessions).toHaveLength(0)
  })

  it('rejects non-string memberIds', async () => {
    const alice = await loginAs('alice')
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'group', title: '群', memberIds: [123] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('denies non-members reading a session', async () => {
    const alice = await loginAs('alice')
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'group', title: '私密群', memberIds: ['u-bob'] },
    })
    const sessionId = created.json().session.id
    const carol = await loginAs('carol')
    const res = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${carol}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 404 for a non-existent session', async () => {
    const alice = await loginAs('alice')
    const res = await built.app.inject({
      method: 'GET',
      url: '/api/v1/sessions/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(res.statusCode).toBe(404)
  })
})
