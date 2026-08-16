import type { FastifyInstance } from 'fastify'
import { signToken } from '../auth.js'
import type { Config } from '../config.js'
import { upsertUser } from '../repos/users.js'
import { recordAudit } from '../repos/audit.js'
import pg from 'pg'

const usernameSchema = {
  type: 'object',
  required: ['username'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[\\w.-]+$' },
  },
  additionalProperties: false,
} as const

export function registerAuth(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  app.post<{ Body: { username: string } }>(
    '/api/v1/auth/login',
    { schema: { body: usernameSchema } },
    async (request, reply) => {
      const user = { id: `u-${request.body.username}`, name: request.body.username }
      const token = await signToken(user, config)
      const member = await upsertUser(pool, user.id, user.name)
      void recordAudit(pool, { actorId: user.id, action: 'login', detail: { name: user.name } }).catch((err) =>
        console.error('[audit] login record failed:', err),
      )
      return { token, user, role: member.role }
    },
  )
}
