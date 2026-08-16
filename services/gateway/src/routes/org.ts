import type { FastifyInstance } from 'fastify'
import { requireAuth, requireRoleFor } from '../middleware.js'
import { AdminLockoutError, listMembers, setRole, type UserRole } from '../repos/users.js'
import { listAudit, recordAudit } from '../repos/audit.js'
import { getQuota, setQuotaBudget } from '../repos/quota.js'
import { createTenant, listTenants, suspendTenant } from '../repos/tenants.js'
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

  // 部门管理（管理员；ABAC 属性来源）：创建部门 + 分配用户部门
  app.post<{ Body: { name?: string } }>(
    '/api/v1/org/departments',
    { preHandler: adminOnly },
    async (request, reply) => {
      const name = request.body?.name?.trim()
      if (!name || name.length > 100) {
        return reply.code(400).send({ error: 'name is required (<=100 chars)' })
      }
      let dept: { id: string; name: string; created_at: Date }
      try {
        const res = await pool.query<{ id: string; name: string; created_at: Date }>(
          'INSERT INTO departments (name) VALUES ($1) RETURNING *',
          [name],
        )
        dept = res.rows[0]!
      } catch (err) {
        // departments.name UNIQUE：重名 → 409
        if (err instanceof Error && err.message.includes('duplicate key')) {
          return reply.code(409).send({ error: 'department name already exists' })
        }
        throw err
      }
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'org.department_created',
        target: dept.id,
        detail: { name: dept.name },
      }).catch((err) => console.error('[audit] department create failed:', err))
      return reply.code(201).send({ department: { id: dept.id, name: dept.name, createdAt: dept.created_at.toISOString() } })
    },
  )

  app.post<{ Params: { id: string }; Body: { departmentId?: string } }>(
    '/api/v1/org/users/:id/department',
    { preHandler: adminOnly },
    async (request, reply) => {
      const userId = request.params.id
      const departmentId = request.body?.departmentId?.trim()
      if (!departmentId) return reply.code(400).send({ error: 'departmentId is required' })
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(departmentId)) {
        return reply.code(400).send({ error: 'departmentId must be a uuid' })
      }
      const dept = await pool.query<{ id: string }>('SELECT id FROM departments WHERE id = $1', [departmentId])
      if (dept.rows.length === 0) return reply.code(400).send({ error: 'department not found' })
      await pool.query('UPDATE users SET department_id = $1 WHERE user_id = $2', [departmentId, userId])
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'org.user_department',
        target: userId,
        detail: { departmentId },
      }).catch((err) => console.error('[audit] department assign failed:', err))
      return { assigned: true }
    },
  )

  // 租户管理（管理员；FR-ORG-01）：创建租户
  app.post<{ Body: { name?: string } }>(
    '/api/v1/org/tenants',
    { preHandler: adminOnly },
    async (request, reply) => {
      const name = request.body?.name?.trim()
      if (!name || name.length > 100) return reply.code(400).send({ error: 'name is required (<=100 chars)' })
      try {
        const tenant = await createTenant(pool, name)
        void recordAudit(pool, {
          actorId: request.user!.id,
          action: 'tenant.created',
          target: tenant.id,
          detail: { name },
        }).catch((err) => console.error('[audit] tenant create failed:', err))
        return reply.code(201).send({ tenant })
      } catch (err) {
        // tenants.name UNIQUE：重名 → 409
        return reply.code(409).send({ error: 'tenant name already exists' })
      }
    },
  )

  // 租户列表（管理员）
  app.get('/api/v1/org/tenants', { preHandler: adminOnly }, async () => {
    return { tenants: await listTenants(pool) }
  })

  // 停用租户（管理员；理由入审计；数据保留）
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/v1/org/tenants/:id/suspend',
    { preHandler: adminOnly },
    async (request, reply) => {
      const id = request.params.id
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'tenant id must be a uuid' })
      }
      const tenant = await suspendTenant(pool, id)
      if (!tenant) return reply.code(409).send({ error: 'tenant not found or already suspended' })
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'tenant.suspended',
        target: id,
        detail: { reason: request.body?.reason?.trim() || null },
      }).catch((err) => console.error('[audit] tenant suspend failed:', err))
      return { tenant }
    },
  )
}
