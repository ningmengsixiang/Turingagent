import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('external api rate limit', () => {
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
    // buildApp overrides 合并 config（server.ts: { ...loadConfig(), ...overrides }）——externalRateLimit=3 使测试快速
    built = await buildApp({ databaseUrl: 'postgres://ta:ta@localhost:5432/ta_dev', externalRateLimit: 3 })
  })
  afterEach(async () => {
    await built.app.close()
  })

  async function loginAs(username: string): Promise<string> {
    const res = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username } })
    return res.json().token as string
  }

  it('rate limits external api calls per key (前 3 次 200，第 4 次 429 + Retry-After)', async () => {
    const admin = await loginAs('alice')
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: '限流测试', memberUser: 'alice' },
    })
    expect(created.statusCode).toBe(201)
    const key = created.json().key as string
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${admin}` },
      payload: { kind: 'project', title: '限流', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string

    // externalRateLimit=3：前 3 次 200
    for (let i = 0; i < 3; i++) {
      const res = await built.app.inject({
        method: 'GET',
        url: `/api/v1/external/sessions/${sessionId}/messages`,
        headers: { 'x-api-key': key },
      })
      expect(res.statusCode).toBe(200)
    }
    // 第 4 次 429 + Retry-After（同一 key 同一窗口内持续 429）
    const limited = await built.app.inject({
      method: 'GET',
      url: `/api/v1/external/sessions/${sessionId}/messages`,
      headers: { 'x-api-key': key },
    })
    expect(limited.statusCode).toBe(429)
    expect(limited.json().error).toBe('rate limit exceeded')
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)

    const stillLimited = await built.app.inject({
      method: 'GET',
      url: `/api/v1/external/sessions/${sessionId}/messages`,
      headers: { 'x-api-key': key },
    })
    expect(stillLimited.statusCode).toBe(429)
  })
})
