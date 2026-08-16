import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('abac access', () => {
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

  it('hides department sessions from non-member outsiders but shows to same-department users', async () => {
    const admin = await loginAs('alice') // 首用户 admin
    // 建部门
    const dept = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/departments',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: '研发部' },
    })
    const departmentId = dept.json().department.id as string
    // alice（admin）与 bob 入部门（演示登录用户 id 前缀为 u-，见 auth.ts）
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/org/users/u-alice/department`,
      headers: { authorization: `Bearer ${admin}` },
      payload: { departmentId },
    })
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/org/users/u-bob/department`,
      headers: { authorization: `Bearer ${admin}` },
      payload: { departmentId },
    })
    // 建部门项目会话（alice 创建，含 bob）
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${admin}` },
      payload: { kind: 'project', title: '部门项目', memberIds: ['u-bob'], departmentId },
    })
    const sessionId = session.json().session.id as string
    // carol 非部门非成员 → 详情 403
    const carol = await loginAs('carol')
    const denied = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${carol}` },
    })
    expect(denied.statusCode).toBe(403)
    // bob 同部门成员 → 可见
    const bob = await loginAs('bob')
    const allowed = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${bob}` },
    })
    expect(allowed.statusCode).toBe(200)
  })
})
