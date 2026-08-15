import type { FastifyInstance } from 'fastify'
import { verifyToken } from '../auth.js'
import type { Config } from '../config.js'

export function registerMe(app: FastifyInstance, config: Config): void {
  app.get('/api/v1/me', async (request, reply) => {
    const header = request.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
    if (!token) return reply.code(401).send({ error: 'missing bearer token' })
    const user = await verifyToken(token, config)
    if (!user) return reply.code(401).send({ error: 'invalid token' })
    return { user }
  })
}
