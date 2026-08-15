import type { FastifyReply, FastifyRequest } from 'fastify'
import { verifyToken, type JwtUser } from './auth.js'
import type { Config } from './config.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtUser
  }
}

export function requireAuth(config: Config) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const match = /^Bearer\s+(\S+)$/.exec(request.headers.authorization ?? '')
    if (!match) {
      await reply.code(401).send({ error: 'malformed authorization header' })
      return
    }
    const user = await verifyToken(match[1]!, config)
    if (!user) {
      await reply.code(401).send({ error: 'invalid token' })
      return
    }
    request.user = user
  }
}
