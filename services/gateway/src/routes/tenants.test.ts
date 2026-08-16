import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('tenant isolation', () => {
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

  it('isolates tenants: cross-tenant sessions are invisible', async () => {
    const admin = await loginAs('alice') // 首用户 admin，default 租户
    // 先注册 bob（计划注：先 loginAs 注册再 UPDATE，否则 UPDATE 无行可改）
    await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob' } })
    // 建第二租户（名字带时间戳：test-helpers 不 truncate tenants，固定名跨运行会撞 409）
    const t2 = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/tenants',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: `租户B-${Date.now()}` },
    })
    const tenantB = t2.json().tenant.id as string
    // 直接改 DB：bob 入租户 B（用户租户分配端点记后续，本计划用 DB UPDATE 模拟）
    await pool.query(`UPDATE users SET tenant_id = $1 WHERE user_id = 'u-bob'`, [tenantB])
    // alice（default 租户）建会话（bob 已在租户 B，但 isMember 校验用 session_members——创建成功）
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${admin}` },
      payload: { kind: 'project', title: 'A租户会话', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string
    // bob（租户 B）访问 A 租户会话 → 403（跨租户，canAccessSession 租户匹配前置 false）
    const bob = await loginAs('bob')
    const denied = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${bob}` },
    })
    expect(denied.statusCode).toBe(403)
    // bob 会话列表不含 A 租户会话（listVisibleSessionIds 限本租户）
    const list = await built.app.inject({
      method: 'GET',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${bob}` },
    })
    const titles = (list.json().sessions as Array<{ title: string }>).map((s) => s.title)
    expect(titles).not.toContain('A租户会话')
  })

  it('suspends a tenant and rejects its members login', async () => {
    const admin = await loginAs('alice')
    // 先注册 carol（计划注：先 loginAs 注册再 UPDATE）
    await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'carol' } })
    // 建租户 C（名字带时间戳：test-helpers 不 truncate tenants，固定名跨运行会撞 409）
    const t2 = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/tenants',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: `租户C-${Date.now()}` },
    })
    const tenantC = t2.json().tenant.id as string
    // 直接改 DB：carol 入租户 C
    await pool.query(`UPDATE users SET tenant_id = $1 WHERE user_id = 'u-carol'`, [tenantC])
    // carol 登录正常（active）
    const ok = await loginAs('carol')
    expect(ok).toBeTruthy()
    // 停用租户 C
    const suspended = await built.app.inject({
      method: 'POST',
      url: `/api/v1/org/tenants/${tenantC}/suspend`,
      headers: { authorization: `Bearer ${admin}` },
      payload: { reason: '试用到期' },
    })
    expect(suspended.statusCode).toBe(200)
    expect(suspended.json().tenant.status).toBe('suspended')
    // carol 再登录 → 403（租户停用，登录闸门 isTenantActive）
    const denied = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'carol' } })
    expect(denied.statusCode).toBe(403)
  })
})
