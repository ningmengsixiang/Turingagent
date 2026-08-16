import type { FastifyInstance } from 'fastify'
import { requireRoleFor } from '../middleware.js'
import { listMembers, setRole, type UserRole } from '../repos/users.js'
import { listAudit, recordAudit } from '../repos/audit.js'
import type { Config } from '../config.js'
import pg from 'pg'

export function registerOrgRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const adminOnly = requireRoleFor(config, pool)

  app.get('/api/v1/org/members', { preHandler: adminOnly }, async () => {
    const members = await listMembers(pool)
    return { members }
  })

  app.patch<{ Params: { id: string }; Body: { role?: string } }>(
    '/api/v1/org/members/:id/role',
    { preHandler: adminOnly },
    async (request, reply) => {
      const role = request.body?.role
      if (role !== 'admin' && role !== 'member') {
        return reply.code(400).send({ error: 'role must be admin|member' })
      }
      const updated = await setRole(pool, request.params.id, role as UserRole)
      if (!updated) return reply.code(404).send({ error: 'member not found' })
      await recordAudit(pool, {
        actorId: request.user!.id,
        action: 'role.changed',
        target: updated.userId,
        detail: { role },
      })
      return { member: updated }
    },
  )

  app.get<{ Querystring: { limit?: string } }>(
    '/api/v1/org/audit',
    { preHandler: adminOnly },
    async (request) => {
      const limit = Number(request.query.limit ?? 50) || 50
      const events = await listAudit(pool, limit)
      return { events }
    },
  )
}
