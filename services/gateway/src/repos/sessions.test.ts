import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from './test-helpers.js'
import { createSession, isMember, listSessionsForUser, markRead } from './sessions.js'
import { createMessage } from './messages.js'

describe('session repository', () => {
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

  it('creates a session with deduped members', async () => {
    const session = await createSession(pool, {
      kind: 'project',
      title: '报销系统',
      memberIds: ['u-alice', 'u-bob', 'u-alice'],
    })
    expect(session.kind).toBe('project')
    expect(session.memberIds).toEqual(['u-alice', 'u-bob'])
    expect(await isMember(pool, session.id, 'u-alice')).toBe(true)
    expect(await isMember(pool, session.id, 'u-carol')).toBe(false)
  })

  it('lists sessions with unread counts', async () => {
    const session = await createSession(pool, {
      kind: 'project',
      title: '报销系统',
      memberIds: ['u-alice', 'u-bob'],
    })
    await createMessage(pool, {
      sessionId: session.id,
      senderId: 'u-bob',
      senderKind: 'human',
      contentType: 'text',
      content: '你好',
      clientMsgId: 'c1',
    })
    const list = await listSessionsForUser(pool, 'u-alice')
    expect(list).toHaveLength(1)
    expect(list[0]!.unreadCount).toBe(1)
    await markRead(pool, session.id, 'u-alice', 1)
    const after = await listSessionsForUser(pool, 'u-alice')
    expect(after[0]!.unreadCount).toBe(0)
  })

  it('excludes sessions where user is not a member', async () => {
    const session = await createSession(pool, {
      kind: 'group',
      title: '财务群',
      memberIds: ['u-bob'],
    })
    const list = await listSessionsForUser(pool, 'u-alice')
    expect(list).toHaveLength(0)
    void session
  })
})
