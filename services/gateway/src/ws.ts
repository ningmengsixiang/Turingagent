import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import type { Message, WsMessageNew, WsMessageUpdated } from '@ta/contracts'
import { verifyToken } from './auth.js'
import type { Config } from './config.js'
import type { ConnectionRegistry } from './registry.js'
import type { AppEventBus } from './events.js'
import { listSessionIdsForUser } from './repos/sessions.js'
import type pg from 'pg'

const OPEN = 1

export function registerWs(
  app: FastifyInstance,
  config: Config,
  pool: pg.Pool,
  registry: ConnectionRegistry,
  events: AppEventBus,
): void {
  app.get('/ws', { websocket: true }, (socket: WebSocket, request) => {
    const token = (request.query as { token?: string }).token
    let authed = false
    // 终态监听必须在异步鉴权之前挂载：窗口期断连不产生死 socket（泄漏修复）
    socket.on('close', () => registry.remove(socket))
    socket.on('error', () => registry.remove(socket))
    socket.on('message', (raw) => {
      if (!authed || socket.readyState !== OPEN) return
      // 调试 echo（Plan 3 移除）
      socket.send(JSON.stringify({ type: 'echo', data: raw.toString() }))
    })
    void (async () => {
      try {
        const user = token ? await verifyToken(token, config) : null
        if (!user) {
          socket.close(4401, 'unauthorized')
          return
        }
        if (socket.readyState !== OPEN) return // 鉴权期间已断开，不注册
        const sessionIds = new Set(await listSessionIdsForUser(pool, user.id))
        registry.add({ socket, userId: user.id, sessionIds })
        authed = true
        if (socket.readyState === OPEN) {
          socket.send(JSON.stringify({ type: 'welcome', user: { id: user.id, name: user.name } }))
        }
      } catch {
        // 握手期异常（DB 故障等）不得崩溃进程（悬浮 IIFE 修复）
        socket.close(1011, 'internal error')
      }
    })()
  })

  events.on('message.created', (message) => {
    const msg = message as Message
    if (typeof msg.sessionId !== 'string') return // 运行时守卫
    const payload: WsMessageNew = { type: 'message.new', message: msg }
    registry.broadcast(msg.sessionId, payload)
  })

  events.on('message.updated', (message) => {
    const msg = message as Message
    if (typeof msg.sessionId !== 'string') return
    const payload: WsMessageUpdated = { type: 'message.updated', message: msg }
    registry.broadcast(msg.sessionId, payload)
  })
}
