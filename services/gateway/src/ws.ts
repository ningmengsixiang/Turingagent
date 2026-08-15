import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
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
    socket.on('message', (raw) => {
      if (!authed || socket.readyState !== OPEN) return
      // 调试 echo（Plan 3 移除）
      socket.send(JSON.stringify({ type: 'echo', data: raw.toString() }))
    })
    void (async () => {
      const user = token ? await verifyToken(token, config) : null
      if (!user) {
        socket.close(4401, 'unauthorized')
        return
      }
      const sessionIds = new Set(await listSessionIdsForUser(pool, user.id))
      registry.add({ socket, userId: user.id, sessionIds })
      socket.on('close', () => registry.remove(socket))
      socket.on('error', () => registry.remove(socket))
      authed = true
      if (socket.readyState === OPEN) {
        socket.send(JSON.stringify({ type: 'welcome', user: { id: user.id, name: user.name } }))
      }
    })()
  })

  events.on('message.created', (message) => {
    const msg = message as { sessionId: string }
    registry.broadcast(msg.sessionId, { type: 'message.new', message })
  })
}
