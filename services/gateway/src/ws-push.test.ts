import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'
import pg from 'pg'
import { buildApp, type BuiltApp } from './server.js'
import { createTestPool, truncateAll } from './repos/test-helpers.js'

const open = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })

function collect(ws: WebSocket): { messages: string[]; waitFor: (count: number) => Promise<void> } {
  const messages: string[] = []
  ws.on('message', (data) => messages.push(data.toString()))
  return {
    messages,
    waitFor: (count: number) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (messages.length >= count) resolve()
          else setTimeout(check, 10)
        }
        check()
      }),
  }
}

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (address === null || typeof address === 'string') throw new Error('unexpected address')
  return address.port
}

describe('gateway ws push', () => {
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

  it('pushes message.new to session members over ws', async () => {
    const alice = await loginAs('alice')
    const sessionRes = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    const sessionId = sessionRes.json().session.id as string

    const port = await listen(built.app)
    const bobToken = await loginAs('bob')
    const bob = await open(`ws://127.0.0.1:${port}/ws?token=${bobToken}`)
    const bobColl = collect(bob)
    await bobColl.waitFor(1) // welcome

    const aliceToken = await loginAs('alice')
    const aliceWs = await open(`ws://127.0.0.1:${port}/ws?token=${aliceToken}`)
    const aliceColl = collect(aliceWs)
    await aliceColl.waitFor(1) // welcome

    const send = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { clientMsgId: 'push-1', contentType: 'text', content: '新消息来了' },
    })
    expect(send.statusCode).toBe(201)

    await bobColl.waitFor(2)
    const event = JSON.parse(bobColl.messages[1] as string) as { type: string; message: { content: string; seq: number } }
    expect(event.type).toBe('message.new')
    expect(event.message.content).toBe('新消息来了')
    expect(event.message.seq).toBe(1)

    bob.close()
    aliceWs.close()
  })

  it('does not push to non-members', async () => {
    const alice = await loginAs('alice')
    const sessionRes = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    const sessionId = sessionRes.json().session.id as string

    const port = await listen(built.app)
    const carol = await open(`ws://127.0.0.1:${port}/ws?token=${await loginAs('carol')}`)
    const carolColl = collect(carol)
    await carolColl.waitFor(1) // welcome

    const aliceToken = await loginAs('alice')
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { clientMsgId: 'push-2', contentType: 'text', content: '机密' },
    })

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(carolColl.messages).toHaveLength(1) // 只有 welcome，无 message.new

    carol.close()
  })
})
