import type { FastifyInstance } from 'fastify'
import { signToken } from '../auth.js'
import type { Config } from '../config.js'

const usernameSchema = {
  type: 'object',
  required: ['username'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[\\w.-]+$' },
  },
  additionalProperties: false,
} as const

export function registerAuth(app: FastifyInstance, config: Config): void {
  app.post<{ Body: { username: string } }>(
    '/api/v1/auth/login',
    { schema: { body: usernameSchema } },
    async (request, reply) => {
      const user = { id: `u-${request.body.username}`, name: request.body.username }
      const token = await signToken(user, config)
      return { token, user }
    },
  )
}
