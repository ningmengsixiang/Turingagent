import { describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'
import { buildApp } from './server.js'

// 消息监听必须在 open 之前挂载：welcome 可能与握手响应同帧到达，
// 迟挂 listener 会丢消息导致 waitFor 永不 resolve（竞态修复）。
const openCollecting = (url: string) =>
  new Promise<{ ws: WebSocket; messages: string[] }>((resolve, reject) => {
    const ws = new WebSocket(url)
    const messages: string[] = []
    ws.on('message', (data) => messages.push(data.toString()))
    ws.on('open', () => resolve({ ws, messages }))
    ws.on('error', reject)
  })

function waitForCount(messages: string[], count: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const check = () => {
      if (messages.length >= count) return resolve()
      if (Date.now() - started > 4000) {
        return reject(new Error(`timed out waiting for ${count} messages (got ${messages.length})`))
      }
      setTimeout(check, 10)
    }
    check()
  })
}

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (address === null || typeof address === 'string') throw new Error('unexpected address')
  return address.port
}

describe('gateway websocket', () => {
  it('rejects connection without a valid token (close 4401)', async () => {
    const { app } = await buildApp()
    const port = await listen(app)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=bad`)
    const close = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }))
      ws.on('error', reject)
    })
    expect(close.code).toBe(4401)
    await app.close()
  })

  it('welcomes then echoes after valid token', async () => {
    const { app } = await buildApp()
    const port = await listen(app)
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'carol' } })
    const token = login.json().token
    const { ws, messages } = await openCollecting(`ws://127.0.0.1:${port}/ws?token=${token}`)
    await waitForCount(messages, 1)
    ws.send('hello')
    await waitForCount(messages, 2)
    expect(JSON.parse(messages[0] as string).type).toBe('welcome')
    expect(JSON.parse(messages[1] as string)).toEqual({ type: 'echo', data: 'hello' })
    ws.close()
    await app.close()
  })
})
