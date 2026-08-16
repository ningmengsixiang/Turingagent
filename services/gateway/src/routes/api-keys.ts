import type { FastifyInstance, FastifyRequest } from 'fastify'
import { requireRoleFor } from '../middleware.js'
import { createApiKey, listApiKeys, revokeApiKey } from '../repos/api-keys.js'
import { recordAudit } from '../repos/audit.js'
import type { Config } from '../config.js'
import pg from 'pg'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerApiKeyRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const adminOnly = requireRoleFor(config, pool)

  app.post<{ Body: { name?: string; memberUser?: string } }>(
    '/api/v1/api-keys',
    { preHandler: adminOnly },
    async (request, reply) => {
      const name = request.body?.name?.trim()
      const memberUser = request.body?.memberUser?.trim()
      if (!name || name.length > 100) {
        return reply.code(400).send({ error: 'name is required (<=100 chars)' })
      }
      if (!memberUser) return reply.code(400).send({ error: 'memberUser is required' })
      // 适配：repos/users.ts 无 getUserByUsername，内联按 name 查 user_id
      const memberRes = await pool.query<{ user_id: string }>(
        'SELECT user_id FROM users WHERE name = $1',
        [memberUser],
      )
      const member = memberRes.rows[0]
      if (!member) return reply.code(400).send({ error: `user ${memberUser} not found` })
      const created = await createApiKey(pool, {
        name,
        memberUserId: member.user_id,
        createdBy: request.user!.id,
      })
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'api_key.created',
        target: created.info.id,
        detail: { name },
      }).catch((err) => console.error('[audit] api key create failed:', err))
      return reply.code(201).send({ key: created.key, info: created.info })
    },
  )

  app.get('/api/v1/api-keys', { preHandler: adminOnly }, async () => {
    return { keys: await listApiKeys(pool) }
  })

  app.post<{ Params: { id: string } }>(
    '/api/v1/api-keys/:id/revoke',
    { preHandler: adminOnly },
    async (request, reply) => {
      const id = request.params.id
      if (!UUID_PATTERN.test(id)) return reply.code(400).send({ error: 'api key id must be a uuid' })
      const revoked = await revokeApiKey(pool, id)
      if (!revoked) return reply.code(404).send({ error: 'api key not found or already revoked' })
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'api_key.revoked',
        target: id,
        detail: { name: revoked.name },
      }).catch((err) => console.error('[audit] api key revoke failed:', err))
      return { info: revoked }
    },
  )
}
