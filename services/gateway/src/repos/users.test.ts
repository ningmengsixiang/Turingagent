import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from './test-helpers.js'
import { upsertUser, getUserRole, listMembers, setRole } from './users.js'

describe('user repository', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
  })

  it('makes the first user an admin and later users members', async () => {
    const first = await upsertUser(pool, 'u-alice', 'alice')
    expect(first.role).toBe('admin')
    const second = await upsertUser(pool, 'u-bob', 'bob')
    expect(second.role).toBe('member')
  })

  it('upserts keep role and update name', async () => {
    await upsertUser(pool, 'u-alice', 'alice')
    await upsertUser(pool, 'u-alice', 'alice2')
    const members = await listMembers(pool)
    expect(members).toHaveLength(1)
    expect(members[0]!.name).toBe('alice2')
    expect(members[0]!.role).toBe('admin')
  })

  it('sets and reads roles', async () => {
    await upsertUser(pool, 'u-alice', 'alice') // 先注册 admin，保证 u-bob 是 member（不依赖前序用例残留）
    await upsertUser(pool, 'u-bob', 'bob')
    expect(await getUserRole(pool, 'u-bob')).toBe('member')
    const updated = await setRole(pool, 'u-bob', 'admin')
    expect(updated?.role).toBe('admin')
    expect(await getUserRole(pool, 'u-bob')).toBe('admin')
    expect(await setRole(pool, 'u-ghost', 'admin')).toBeNull()
  })
})
