import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { verifyToken } from './auth.js'
import type { Config } from './config.js'

const OPEN = 1

export function registerWs(app: FastifyInstance, config: Config): void {
  app.get('/ws', { websocket: true }, (socket: WebSocket, request) => {
    const token = (request.query as { token?: string }).token
    // 消息监听必须在鉴权 await 之前挂载：窗口期到达的客户端消息不能丢（竞态修复）
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
