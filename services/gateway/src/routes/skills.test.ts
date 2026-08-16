import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('skill routes', () => {
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

  it('lists skills from manifest files', async () => {
    const res = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } })
    const token = res.json().token as string
    const list = await built.app.inject({
      method: 'GET',
      url: '/api/v1/skills',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(list.statusCode).toBe(200)
    const ids = (list.json().skills as Array<{ id: string }>).map((s) => s.id)
    expect(ids).toContain('fullstack')
    expect(ids).toContain('pm')
  })

  it('binds a skill to a session', async () => {
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
      url: `/api/v1/sessions/${sessionId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skillId: 'fullstack' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().skill.name).toBe('全栈开发')
  })

  it('rejects an unknown skill id', async () => {
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
      url: `/api/v1/sessions/${sessionId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skillId: 'nope' },
    })
    expect(res.statusCode).toBe(400)
  })
})
