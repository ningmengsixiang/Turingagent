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

  it('cannot demote the last admin (409)', async () => {
    const alice = await loginAs('alice') // 唯一 admin
    const res = await built.app.inject({
      method: 'PATCH',
      url: '/api/v1/org/members/u-alice/role',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { role: 'member' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('returns 404 for an unknown member role change', async () => {
    const alice = await loginAs('alice')
    const res = await built.app.inject({
      method: 'PATCH',
      url: '/api/v1/org/members/u-ghost/role',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { role: 'admin' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('rejects an invalid role with 400', async () => {
    const alice = await loginAs('alice')
    const res = await built.app.inject({
      method: 'PATCH',
      url: '/api/v1/org/members/u-alice/role',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { role: 'superuser' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('member cannot view audit (403)', async () => {
    const alice = await loginAs('alice')
    await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob' } })
    const bobRes = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob' } })
    const res = await built.app.inject({
      method: 'GET',
      url: '/api/v1/org/audit',
      headers: { authorization: `Bearer ${bobRes.json().token}` },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('tenant management routes', () => {
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

  it('admin creates a tenant (201) and it appears in the list', async () => {
    const admin = await loginAs('alice')
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/tenants',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: `租户B-${Date.now()}` },
    })
    expect(res.statusCode).toBe(201)
    const tenant = res.json().tenant
    expect(tenant.name).toContain('租户B')
    expect(tenant.status).toBe('active')
    const list = await built.app.inject({
      method: 'GET',
      url: '/api/v1/org/tenants',
      headers: { authorization: `Bearer ${admin}` },
    })
    expect(list.statusCode).toBe(200)
    const names = list.json().tenants.map((t: { name: string }) => t.name)
    expect(names).toContain('default') // 种子租户常驻（test-helpers 不 truncate tenants）
    expect(names.some((n: string) => n.includes('租户B'))).toBe(true)
  })

  it('rejects a duplicate tenant name with 409', async () => {
    const admin = await loginAs('alice')
    const dupName = `租户Dup-${Date.now()}`
    await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/tenants',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: dupName },
    })
    const dup = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/tenants',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: dupName },
    })
    expect(dup.statusCode).toBe(409)
  })

  it('rejects a missing tenant name with 400', async () => {
    const admin = await loginAs('alice')
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/tenants',
      headers: { authorization: `Bearer ${admin}` },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('member cannot access tenant management (403)', async () => {
    await loginAs('alice') // 第一个用户 → admin
    await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob' } })
    const bobRes = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob' } })
    const bobToken = bobRes.json().token as string
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/tenants',
      headers: { authorization: `Bearer ${bobToken}` },
      payload: { name: `租户B-${Date.now()}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('admin suspends a tenant (200, audited) and re-suspend is 409', async () => {
    const admin = await loginAs('alice')
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/tenants',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: `租户C-${Date.now()}` },
    })
    const tenantId = created.json().tenant.id as string
    const suspended = await built.app.inject({
      method: 'POST',
      url: `/api/v1/org/tenants/${tenantId}/suspend`,
      headers: { authorization: `Bearer ${admin}` },
      payload: { reason: '试用到期' },
    })
    expect(suspended.statusCode).toBe(200)
    expect(suspended.json().tenant.status).toBe('suspended')
    const audit = await built.app.inject({
      method: 'GET',
      url: '/api/v1/org/audit',
      headers: { authorization: `Bearer ${admin}` },
    })
    const actions = audit.json().events.map((e: { action: string }) => e.action)
    expect(actions).toContain('tenant.suspended')
    // 已停用 → 409
    const again = await built.app.inject({
      method: 'POST',
      url: `/api/v1/org/tenants/${tenantId}/suspend`,
      headers: { authorization: `Bearer ${admin}` },
      payload: {},
    })
    expect(again.statusCode).toBe(409)
  })

  it('rejects a non-uuid tenant id with 400', async () => {
    const admin = await loginAs('alice')
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/tenants/not-a-uuid/suspend',
      headers: { authorization: `Bearer ${admin}` },
      payload: { reason: 'x' },
    })
    expect(res.statusCode).toBe(400)
  })
})
