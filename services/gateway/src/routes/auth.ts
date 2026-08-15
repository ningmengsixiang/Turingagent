import type { FastifyInstance } from 'fastify'
import { signToken } from '../auth.js'
import type { Config } from '../config.js'

interface LoginBody {
  username?: string
}

export function registerAuth(app: FastifyInstance, config: Config): void {
  app.post<{ Body: LoginBody }>('/api/v1/auth/login', async (request, reply) => {
    const username = request.body?.username?.trim()
    if (!username) {
      return reply.code(400).send({ error: 'username is required' })
    }
    const user = { id: `u-${username}`, name: username }
    const token = await signToken(user, config)
    return { token, user }
  })
}
