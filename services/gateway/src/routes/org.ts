import type { FastifyInstance } from 'fastify'
import { requireAuth, requireRoleFor } from '../middleware.js'
import { AdminLockoutError, listMembers, setRole, type UserRole } from '../repos/users.js'
import { listAudit, recordAudit } from '../repos/audit.js'
import { getQuota, setQuotaBudget } from '../repos/quota.js'
import type { Config } from '../config.js'
import pg from 'pg'

export function registerOrgRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const adminOnly = requireRoleFor(config, pool)
  // 配额查询供所有登录用户（前端配额条）；调额仍走 adminOnly
  const auth = requireAuth(config, pool)

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
      let updated
      try {
        updated = await setRole(pool, request.params.id, role as UserRole)
      } catch (err) {
        if (err instanceof AdminLockoutError) {
          return reply.code(409).send({ error: err.message })
        }
        throw err
      }
      if (!updated) return reply.code(404).send({ error: 'member not found' })
      // 审计统一 fire-and-forget（M4）：尽力写、不阻断主流程；失败记日志
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'role.changed',
        target: updated.userId,
        detail: { role },
      }).catch((err) => console.error('[audit] role change record failed:', err))
      return { member: updated }
    },
  )

  app.get<{ Querystring: { limit?: string } }>(
    '/api/v1/org/audit',
    { preHandler: adminOnly },
    async (request) => {
      const limit = Math.floor(Number(request.query.limit ?? 50)) || 50
      const events = await listAudit(pool, limit)
      return { events }
    },
  )

  // 配额查询（登录用户可见；前端配额条）
  app.get('/api/v1/org/quota', { preHandler: auth }, async () => {
    return { quota: await getQuota(pool) }
  })

  // 调额（管理员；审计留痕）
  app.post<{ Body: { budget?: number } }>(
    '/api/v1/org/quota',
    { preHandler: adminOnly },
    async (request, reply) => {
      const budget = request.body?.budget
      if (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 0) {
        return reply.code(400).send({ error: 'budget must be a non-negative number' })
      }
      try {
        const quota = await setQuotaBudget(pool, budget)
        void recordAudit(pool, {
          actorId: request.user!.id,
          action: 'quota.updated',
          target: 'enterprise',
          detail: { budget },
        }).catch((err) => console.error('[audit] quota update failed:', err))
        return { quota }
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'invalid budget' })
      }
    },
  )
}
