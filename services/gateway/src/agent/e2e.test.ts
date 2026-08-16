import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'
import { StubProvider } from '../model/stub.js'

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

describe('agent e2e (mention → reply → ws push)', () => {
  let built: BuiltApp
  let pool: pg.Pool
  let stub: StubProvider

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
    stub = new StubProvider('好的，我来实现报销系统。')
    built = await buildApp(
      { databaseUrl: 'postgres://ta:ta@localhost:5432/ta_dev', modelApiKey: 'sk-test' },
      { provider: stub },
    )
  })
  afterEach(async () => {
    await built.app.close()
  })

  async function loginAs(username: string): Promise<string> {
    const res = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username } })
    return res.json().token as string
  }

  it('user @mentions Ta-Fullstack and receives the agent reply over ws', async () => {
    const alice = await loginAs('alice')
    const sessionRes = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-alice'] },
    })
    const sessionId = sessionRes.json().session.id as string

    const port = await listen(built.app)
    const aliceWs = await open(`ws://127.0.0.1:${port}/ws?token=${await loginAs('alice')}`)
    const coll = collect(aliceWs)
    await coll.waitFor(1) // welcome

    const send = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'mention-1', contentType: 'text', content: '@Ta-Fullstack 帮我做报销系统' },
    })
    expect(send.statusCode).toBe(201)

    // welcome + 用户消息 + agent 回复 = 3 帧
    await coll.waitFor(3)
    const last = JSON.parse(coll.messages[2] as string) as {
      type: string
      message: { senderKind: string; senderId: string; content: string; seq: number }
    }
    expect(last.type).toBe('message.new')
    expect(last.message.senderKind).toBe('agent')
    expect(last.message.senderId).toBe('agent-ta-fullstack')
    expect(last.message.content).toBe('好的，我来实现报销系统。')
    expect(last.message.seq).toBe(2)
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]!.userInput).toBe('帮我做报销系统')

    aliceWs.close()
  })

  it('does not trigger the agent without a mention', async () => {
    const alice = await loginAs('alice')
    const sessionRes = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-alice'] },
    })
    const sessionId = sessionRes.json().session.id as string

    await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'plain-1', contentType: 'text', content: '大家好' },
    })

    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(stub.calls).toHaveLength(0)
  })
})
