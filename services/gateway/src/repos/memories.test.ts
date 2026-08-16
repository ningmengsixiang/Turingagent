import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from './test-helpers.js'
import { createSession } from './sessions.js'
import { createMemory, getMemory, listMemoriesForSession, updateMemoryContent, listMemoryVersions } from './memories.js'

describe('memory repository', () => {
  let pool: pg.Pool
  let sessionId: string

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
    const session = await createSession(pool, { kind: 'project', title: '报销系统', memberIds: ['u-alice'] })
    sessionId = session.id
  })

  it('creates a memory with version 1', async () => {
    const memory = await createMemory(pool, {
      sessionId,
      title: '需求基线',
      content: '报销系统需求基线 v1',
      createdBy: 'u-alice',
    })
    expect(memory.currentVersion).toBe(1)
    expect(memory.title).toBe('需求基线')
    const versions = await listMemoryVersions(pool, memory.id)
    expect(versions).toHaveLength(1)
    expect(versions[0]!.version).toBe(1)
  })

  it('edits create new versions with history', async () => {
    const memory = await createMemory(pool, {
      sessionId,
      title: '需求基线',
      content: 'v1',
      createdBy: 'u-alice',
    })
    const v2 = await updateMemoryContent(pool, { id: memory.id, content: 'v2 内容', editedBy: 'u-bob' })
    expect(v2.currentVersion).toBe(2)
    expect(v2.content).toBe('v2 内容')
    const v3 = await updateMemoryContent(pool, { id: memory.id, content: 'v3 内容', editedBy: 'u-alice' })
    expect(v3.currentVersion).toBe(3)
    const versions = await listMemoryVersions(pool, memory.id)
    expect(versions).toHaveLength(3)
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3])
    expect(versions[2]!.editedBy).toBe('u-alice')
  })

  it('assigns unique versions under concurrent edits (并发回归)', async () => {
    const memory = await createMemory(pool, {
      sessionId,
      title: '需求基线',
      content: 'v1',
      createdBy: 'u-alice',
    })
    const results = await Promise.all([
      updateMemoryContent(pool, { id: memory.id, content: '并发 A', editedBy: 'u-alice' }),
      updateMemoryContent(pool, { id: memory.id, content: '并发 B', editedBy: 'u-bob' }),
    ])
    const versions = results.map((r) => r.currentVersion).sort((a, b) => a - b)
    expect(new Set(versions).size).toBe(2)
    expect(versions[0]).toBe(2)
    expect(versions[1]).toBe(3)
    const all = await listMemoryVersions(pool, memory.id)
    expect(all.map((v) => v.version)).toEqual([1, 2, 3])
  })

  it('lists memories newest first', async () => {
    await createMemory(pool, { sessionId, title: '记忆一', content: 'a', createdBy: 'u-alice' })
    await createMemory(pool, { sessionId, title: '记忆二', content: 'b', createdBy: 'u-alice' })
    const memories = await listMemoriesForSession(pool, sessionId)
    expect(memories).toHaveLength(2)
    expect(memories[0]!.title).toBe('记忆二') // updated_at DESC
  })

  it('fails updating an unknown memory', async () => {
    await expect(
      updateMemoryContent(pool, { id: '00000000-0000-0000-0000-000000000000', content: 'x', editedBy: 'u-alice' }),
    ).rejects.toThrow(/memory not found/)
  })
})
