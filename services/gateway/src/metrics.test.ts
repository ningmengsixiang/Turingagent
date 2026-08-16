import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from './server.js'
import { createTestPool, truncateAll } from './repos/test-helpers.js'

describe('metrics', () => {
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

  it('exposes prometheus metrics without auth', async () => {
    const res = await built.app.inject({ method: 'GET', url: '/metrics' })
    expect(res.statusCode).toBe(200)
    const text = res.body
    expect(text).toContain('# HELP')
    expect(text).toContain('http_requests_total')
    expect(text).toContain('quota_used')
    expect(text).toContain('ws_connections')
  })

  it('counts http requests per route', async () => {
    await built.app.inject({ method: 'GET', url: '/metrics' })
    await built.app.inject({ method: 'GET', url: '/healthz' })
    const text = (await built.app.inject({ method: 'GET', url: '/metrics' })).body
    expect(text).toContain('http_requests_total{route="/healthz",status="200"} 1')
  })
})
