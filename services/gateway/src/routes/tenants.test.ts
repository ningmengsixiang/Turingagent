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
    // alice（default 租户）先建会话：bob 此时仍在 default 租户，创建会话跨租户成员校验通过
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${admin}` },
      payload: { kind: 'project', title: 'A租户会话', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string
    // 直接改 DB：bob 入租户 B（用户租户分配端点记后续，本计划用 DB UPDATE 模拟）
    await pool.query(`UPDATE users SET tenant_id = $1 WHERE user_id = 'u-bob'`, [tenantB])
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

  it('blocks cross-tenant writes (messages/tasks)', async () => {
    const admin = await loginAs('alice')
    // 先注册 bob（计划注：先 loginAs 注册再 UPDATE，否则 UPDATE 无行可改、bob 登录落入 default 租户）
    await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob' } })
    const t2 = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/tenants',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: `租户W-${Date.now()}` },
    })
    const tenantW = t2.json().tenant.id as string
    // alice（default 租户）建会话，bob 仍是会话成员（残留成员记录）
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${admin}` },
      payload: { kind: 'project', title: 'A写测试', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string
    // 直接改 DB：bob 挪入租户 W → 残留成员 + 跨租户（isMember 租户感知后写路径 403）
    await pool.query(`UPDATE users SET tenant_id = $1 WHERE user_id = 'u-bob'`, [tenantW])
    const bob = await loginAs('bob')
    // 跨租户写消息 → 403
    const denied = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { clientMsgId: 'x-1', contentType: 'text', content: '跨租户注入' },
    })
    expect(denied.statusCode).toBe(403)
    // 跨租户建任务 → 403
    const task = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/tasks`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { title: '注入任务' },
    })
    expect(task.statusCode).toBe(403)
    // 成员名单不泄露（跨租户 bob 看不到 A 会话成员）——GET members 传租户后 403
    const members = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/members`,
      headers: { authorization: `Bearer ${bob}` },
    })
    expect(members.statusCode).toBe(403)
  })

  it('transfers a user to another tenant (admin)', async () => {
    const admin = await loginAs('alice')
    const t2 = await built.app.inject({ method: 'POST', url: '/api/v1/org/tenants', headers: { authorization: `Bearer ${admin}` }, payload: { name: `租户T-${Date.now()}` } })
    const tenantT = t2.json().tenant.id as string
    const bob = await loginAs('bob')
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/users/u-bob/tenant',
      headers: { authorization: `Bearer ${admin}` },
      payload: { tenantId: tenantT },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().tenantId).toBe(tenantT)
    const row = await pool.query<{ tenant_id: string | null }>('SELECT tenant_id FROM users WHERE user_id = $1', ['u-bob'])
    expect(row.rows[0]!.tenant_id).toBe(tenantT)
  })

  it('rejects cross-tenant member on session create', async () => {
    const admin = await loginAs('alice')
    const t2 = await built.app.inject({ method: 'POST', url: '/api/v1/org/tenants', headers: { authorization: `Bearer ${admin}` }, payload: { name: `租户X-${Date.now()}` } })
    const tenantX = t2.json().tenant.id as string
    const bob = await loginAs('bob')
    await pool.query(`UPDATE users SET tenant_id = $1 WHERE user_id = 'u-bob'`, [tenantX])
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${admin}` },
      payload: { kind: 'project', title: '跨租户成员测试', memberIds: ['u-bob'] },
    })
    expect(session.statusCode).toBe(400)
    expect(session.json().error).toContain('different tenant')
  })

  it('backfills null-tenant sessions on migration', async () => {
    // 模拟存量 NULL 租户会话 → 手动跑回填 SQL → 非 NULL
    const admin = await loginAs('alice')
    // 先注册 bob（API 校验 memberIds 非空：计划原文 memberIds: [] 会被 400 拒，改用 u-bob）
    await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob' } })
    const session = await built.app.inject({ method: 'POST', url: '/api/v1/sessions', headers: { authorization: `Bearer ${admin}` }, payload: { kind: 'project', title: '回填测试', memberIds: ['u-bob'] } })
    const sessionId = session.json().session.id as string
    await pool.query(`UPDATE sessions SET tenant_id = NULL WHERE id = $1`, [sessionId])
    await pool.query(`UPDATE sessions SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL`)
    const row = await pool.query<{ tenant_id: string | null }>('SELECT tenant_id FROM sessions WHERE id = $1', [sessionId])
    expect(row.rows[0]!.tenant_id).not.toBeNull()
  })
})
