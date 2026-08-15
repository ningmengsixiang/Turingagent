import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from './test-helpers.js'
import { createSession } from './sessions.js'
import { createMessage, listMessages } from './messages.js'

describe('message repository', () => {
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
    const session = await createSession(pool, {
      kind: 'project',
      title: '报销系统',
      memberIds: ['u-alice', 'u-bob'],
    })
    sessionId = session.id
  })

  it('assigns monotonic seq in send order', async () => {
    const a = await createMessage(pool, {
      sessionId,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content: '第一条',
      clientMsgId: 'a1',
    })
    const b = await createMessage(pool, {
      sessionId,
      senderId: 'u-bob',
      senderKind: 'human',
      contentType: 'text',
      content: '第二条',
      clientMsgId: 'b1',
    })
    expect(a.message.seq).toBe(1)
    expect(b.message.seq).toBe(2)
    expect(a.created).toBe(true)
  })

  it('returns the existing message on duplicate clientMsgId', async () => {
    const first = await createMessage(pool, {
      sessionId,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content: '唯一',
      clientMsgId: 'dup-1',
    })
    const second = await createMessage(pool, {
      sessionId,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content: '唯一',
      clientMsgId: 'dup-1',
    })
    expect(second.created).toBe(false)
    expect(second.message.id).toBe(first.message.id)
    expect(second.message.seq).toBe(1)
  })

  it('lists messages after a given seq', async () => {
    await createMessage(pool, {
      sessionId,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content: 'm1',
      clientMsgId: 'm1',
    })
    await createMessage(pool, {
      sessionId,
      senderId: 'u-bob',
      senderKind: 'human',
      contentType: 'text',
      content: 'm2',
      clientMsgId: 'm2',
    })
    const after = await listMessages(pool, sessionId, 1, 10)
    expect(after).toHaveLength(1)
    expect(after[0]!.content).toBe('m2')
    expect(after[0]!.seq).toBe(2)
  })

  it('fails when session does not exist', async () => {
    await expect(
      createMessage(pool, {
        sessionId: '00000000-0000-0000-0000-000000000000',
        senderId: 'u-alice',
        senderKind: 'human',
        contentType: 'text',
        content: 'x',
        clientMsgId: 'x1',
      }),
    ).rejects.toThrow(/session not found/)
  })

  it('treats clientMsgId as globally unique per sender across sessions (幂等契约)', async () => {
    const session2 = await createSession(pool, {
      kind: 'project',
      title: '另一个项目',
      memberIds: ['u-alice'],
    })
    const first = await createMessage(pool, {
      sessionId,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content: 'A',
      clientMsgId: 'global-1',
    })
    const replay = await createMessage(pool, {
      sessionId: session2.id,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content: 'B',
      clientMsgId: 'global-1',
    })
    expect(replay.created).toBe(false)
    expect(replay.message.sessionId).toBe(sessionId)
    expect(replay.message.content).toBe('A')
  })
})
