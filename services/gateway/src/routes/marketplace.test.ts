import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../skills')

describe('marketplace routes', () => {
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
    // 清理测试安装（避免污染 skills 目录）
    const target = path.join(SKILLS_DIR, 'qa-review.json')
    if (existsSync(target)) unlinkSync(target)
  })

  async function loginAs(username: string): Promise<string> {
    const res = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username } })
    return res.json().token as string
  }

  it('lists marketplace skills (not installed initially)', async () => {
    const alice = await loginAs('alice')
    const res = await built.app.inject({ method: 'GET', url: '/api/v1/marketplace/skills', headers: { authorization: `Bearer ${alice}` } })
    expect(res.statusCode).toBe(200)
    const qa = (res.json().skills as Array<{ id: string; installed: boolean }>).find((s) => s.id === 'qa-review')
    expect(qa).toBeTruthy()
    expect(qa!.installed).toBe(false)
  })

  it('installs a marketplace skill (admin) and lists it as installed', async () => {
    const admin = await loginAs('alice') // 首用户 admin
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/marketplace/skills/qa-review/install',
      headers: { authorization: `Bearer ${admin}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().installed).toBe(true)
    expect(existsSync(path.join(SKILLS_DIR, 'qa-review.json'))).toBe(true)
    // 再装 → 409（无 force）
    const dup = await built.app.inject({
      method: 'POST',
      url: '/api/v1/marketplace/skills/qa-review/install',
      headers: { authorization: `Bearer ${admin}` },
    })
    expect(dup.statusCode).toBe(409)
    // force 覆盖 → 200
    const forced = await built.app.inject({
      method: 'POST',
      url: '/api/v1/marketplace/skills/qa-review/install',
      headers: { authorization: `Bearer ${admin}` },
      payload: { force: true },
    })
    expect(forced.statusCode).toBe(200)
    expect(forced.json().overwritten).toBe(true)
    // 列表标记 installed
    const list = await built.app.inject({ method: 'GET', url: '/api/v1/marketplace/skills', headers: { authorization: `Bearer ${admin}` } })
    const qa = (list.json().skills as Array<{ id: string; installed: boolean }>).find((s) => s.id === 'qa-review')
    expect(qa!.installed).toBe(true)
  })

  it('rejects non-admin install and path traversal ids', async () => {
    const alice = await loginAs('alice')
    const bob = await loginAs('bob')
    // 非 admin → 403
    const denied = await built.app.inject({ method: 'POST', url: '/api/v1/marketplace/skills/qa-review/install', headers: { authorization: `Bearer ${bob}` } })
    expect(denied.statusCode).toBe(403)
    // 路径穿越 → 400（白名单正则拒绝）
    const traversal = await built.app.inject({ method: 'POST', url: '/api/v1/marketplace/skills/..%2F..%2Fetc%2Fpasswd/install', headers: { authorization: `Bearer ${alice}` } })
    expect(traversal.statusCode).toBe(400)
  })
})
