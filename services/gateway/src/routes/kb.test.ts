import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('kb routes', () => {
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

  it('creates and lists kb documents', async () => {
    const login = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } })
    const token = login.json().token as string
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/kb`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '登录方案', content: '采用 JWT + 刷新令牌，令牌有效期 2 小时。' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().document.title).toBe('登录方案')

    const list = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/kb`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(list.json().documents).toHaveLength(1)
  })

  it('searches kb by keyword', async () => {
    const login = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } })
    const token = login.json().token as string
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/kb`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '登录方案', content: 'JWT 刷新令牌' },
    })
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/kb`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '部署方案', content: 'Docker Compose 一键部署' },
    })
    const hit = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/kb?q=${encodeURIComponent('JWT')}`,
      headers: { authorization: `Bearer ${token}` },
    })
    const docs = hit.json().documents as Array<{ title: string }>
    expect(docs).toHaveLength(1)
    expect(docs[0]!.title).toBe('登录方案')
  })

  it('rejects oversized content', async () => {
    const login = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } })
    const token = login.json().token as string
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/kb`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '超长', content: 'x'.repeat(10_001) },
    })
    expect(res.statusCode).toBe(400)
  })
})
