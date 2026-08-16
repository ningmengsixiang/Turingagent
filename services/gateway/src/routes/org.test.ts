import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('org routes', () => {
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

  async function loginAs(username: string): Promise<{ token: string; role: string }> {
    const res = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username } })
    return res.json()
  }

  it('first user becomes admin and can list members', async () => {
    const alice = await loginAs('alice')
    expect(alice.role).toBe('admin')
    const res = await built.app.inject({
      method: 'GET',
      url: '/api/v1/org/members',
      headers: { authorization: `Bearer ${alice.token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().members).toHaveLength(1)
  })

  it('member cannot access admin routes', async () => {
    const alice = await loginAs('alice') // 第一个用户 → admin
    await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob' } }) // 注册为 member
    const bobRes = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob' } })
    const bobToken = bobRes.json().token as string
    expect(bobRes.json().role).toBe('member')
    const res = await built.app.inject({
      method: 'GET',
      url: '/api/v1/org/members',
      headers: { authorization: `Bearer ${bobToken}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('admin changes a member role and it is audited', async () => {
    const alice = await loginAs('alice')
    await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob' } })
    const res = await built.app.inject({
      method: 'PATCH',
      url: '/api/v1/org/members/u-bob/role',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { role: 'admin' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().member.role).toBe('admin')
    const audit = await built.app.inject({
      method: 'GET',
      url: '/api/v1/org/audit',
      headers: { authorization: `Bearer ${alice.token}` },
    })
    expect(audit.statusCode).toBe(200)
    const actions = audit.json().events.map((e: { action: string }) => e.action)
    expect(actions).toContain('role.changed')
  })
})
