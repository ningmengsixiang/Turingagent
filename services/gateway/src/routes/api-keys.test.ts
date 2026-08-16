import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('api key routes', () => {
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

  it('creates lists and revokes api keys', async () => {
    const admin = await loginAs('alice') // 首用户 admin
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: '工单系统', memberUser: 'alice' },
    })
    expect(created.statusCode).toBe(201)
    const key = created.json().key as string
    expect(key.startsWith('ta_')).toBe(true)

    const list = await built.app.inject({
      method: 'GET',
      url: '/api/v1/api-keys',
      headers: { authorization: `Bearer ${admin}` },
    })
    expect(list.json().keys).toHaveLength(1)
    expect(list.json().keys[0].maskedKey).toContain('****')

    const id = list.json().keys[0].id as string
    const revoked = await built.app.inject({
      method: 'POST',
      url: `/api/v1/api-keys/${id}/revoke`,
      headers: { authorization: `Bearer ${admin}` },
    })
    expect(revoked.statusCode).toBe(200)
    expect(revoked.json().info.revokedAt).toBeTruthy()
  })

  it('rejects non-admin api key management', async () => {
    const alice = await loginAs('alice')
    const bob = await loginAs('bob')
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: { authorization: `Bearer ${bob}` },
      payload: { name: 'x', memberUser: 'alice' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('external api sends and lists messages with the bound user identity', async () => {
    const admin = await loginAs('alice')
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: '工单系统', memberUser: 'alice' },
    })
    const key = created.json().key as string
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${admin}` },
      payload: { kind: 'project', title: '集成会话', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string

    const sent = await built.app.inject({
      method: 'POST',
      url: `/api/v1/external/sessions/${sessionId}/messages`,
      headers: { 'x-api-key': key },
      payload: { content: '工单 #123 已创建' },
    })
    expect(sent.statusCode).toBe(201)
    expect(sent.json().message.senderId).toBe('u-alice') // 绑定用户身份

    const listed = await built.app.inject({
      method: 'GET',
      url: `/api/v1/external/sessions/${sessionId}/messages`,
      headers: { 'x-api-key': key },
    })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().messages.some((m: { content: string }) => m.content === '工单 #123 已创建')).toBe(true)

    // 无效 key → 401
    const denied = await built.app.inject({
      method: 'GET',
      url: `/api/v1/external/sessions/${sessionId}/messages`,
      headers: { 'x-api-key': 'ta_invalid' },
    })
    expect(denied.statusCode).toBe(401)
  })

  it('rejects a revoked api key with 401', async () => {
    const admin = await loginAs('alice')
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: '临时', memberUser: 'alice' },
    })
    const key = created.json().key as string
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${admin}` },
      payload: { kind: 'project', title: '撤销测试', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string
    // 撤销前可用
    const before = await built.app.inject({
      method: 'GET',
      url: `/api/v1/external/sessions/${sessionId}/messages`,
      headers: { 'x-api-key': key },
    })
    expect(before.statusCode).toBe(200)
    // 撤销
    const list = await built.app.inject({ method: 'GET', url: '/api/v1/api-keys', headers: { authorization: `Bearer ${admin}` } })
    const id = list.json().keys.find((k: { name: string }) => k.name === '临时').id as string
    await built.app.inject({ method: 'POST', url: `/api/v1/api-keys/${id}/revoke`, headers: { authorization: `Bearer ${admin}` } })
    // 撤销后 401
    const after = await built.app.inject({
      method: 'GET',
      url: `/api/v1/external/sessions/${sessionId}/messages`,
      headers: { 'x-api-key': key },
    })
    expect(after.statusCode).toBe(401)
  })

  it('rejects an external call when the bound user is not a member', async () => {
    const admin = await loginAs('alice')
    await loginAs('carol') // 先注册 carol，否则生成 key 时 user not found → 400
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: '外部工单', memberUser: 'carol' }, // carol 不是会话成员
    })
    const key = created.json().key as string
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${admin}` },
      payload: { kind: 'project', title: '成员测试', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string
    const denied = await built.app.inject({
      method: 'POST',
      url: `/api/v1/external/sessions/${sessionId}/messages`,
      headers: { 'x-api-key': key },
      payload: { content: 'carol 非成员应被拒' },
    })
    expect(denied.statusCode).toBe(403)
  })
})
