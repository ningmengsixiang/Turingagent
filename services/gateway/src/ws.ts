import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { verifyToken } from './auth.js'
import type { Config } from './config.js'

const OPEN = 1

export function registerWs(
  app: FastifyInstance,
  config: Config,
  _pool: unknown,
  _registry: unknown,
  _events: unknown,
): void {
  app.get('/ws', { websocket: true }, (socket: WebSocket, request) => {
    const token = (request.query as { token?: string }).token
    let authed = false
    socket.on('message', (raw) => {
      if (!authed || socket.readyState !== OPEN) return
      socket.send(JSON.stringify({ type: 'echo', data: raw.toString() }))
    })
    void (async () => {
      const user = token ? await verifyToken(token, config) : null
      if (!user) {
        socket.close(4401, 'unauthorized')
        return
      }
      authed = true
      if (socket.readyState === OPEN) {
        socket.send(JSON.stringify({ type: 'welcome', user: { id: user.id, name: user.name } }))
      }
    })()
  })
}
