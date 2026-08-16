import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('memory routes', () => {
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

  it('creates and lists memories for a session', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/memories`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '需求基线', content: '报销系统需求基线 v1' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().memory.currentVersion).toBe(1)
    const list = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/memories`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(list.json().memories).toHaveLength(1)
  })

  it('edits create versions and history is queryable', async () => {
    const alice = await loginAs('alice')
    const bob = await loginAs('bob')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/memories`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '需求基线', content: 'v1' },
    })
    const memoryId = created.json().memory.id as string
    const edited = await built.app.inject({
      method: 'PUT',
      url: `/api/v1/memories/${memoryId}`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { content: 'v2 更新内容' },
    })
    expect(edited.statusCode).toBe(200)
    expect(edited.json().memory.currentVersion).toBe(2)
    const versions = await built.app.inject({
      method: 'GET',
      url: `/api/v1/memories/${memoryId}/versions`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(versions.json().versions).toHaveLength(2)
    expect(versions.json().versions[1]!.content).toBe('v2 更新内容')
  })

  it('denies non-members accessing memories', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const carol = await loginAs('carol')
    const res = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/memories`,
      headers: { authorization: `Bearer ${carol}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejects emptying the title on edit with 400', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/memories`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '需求基线', content: 'v1' },
    })
    const memoryId = created.json().memory.id as string
    const res = await built.app.inject({
      method: 'PUT',
      url: `/api/v1/memories/${memoryId}`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '  ', content: 'v2' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for an unknown memory edit', async () => {
    const alice = await loginAs('alice')
    const res = await built.app.inject({
      method: 'PUT',
      url: '/api/v1/memories/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${alice}` },
      payload: { content: 'v2' },
    })
    expect(res.statusCode).toBe(404)
  })
})
