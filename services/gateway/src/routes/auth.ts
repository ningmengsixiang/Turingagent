import type { FastifyInstance } from 'fastify'
import { signToken } from '../auth.js'
import type { Config } from '../config.js'
import { upsertUser } from '../repos/users.js'
import { ensureUserTenant, isTenantActive } from '../repos/tenants.js'
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
      const member = await upsertUser(pool, user.id, user.name)
      // 登录引导（FR-ORG-01）：无租户用户自动入 default 租户
      const tenantId = await ensureUserTenant(pool, user.id)
      // 租户闸门（FR-SEC-02）：停用租户成员登录被拒（数据保留，仅拒绝登录）
      if (!(await isTenantActive(pool, tenantId))) {
        return reply.code(403).send({ error: '租户已停用，请联系管理员' })
      }
      const token = await signToken(user, config)
      void recordAudit(pool, { actorId: user.id, action: 'login', detail: { name: user.name } }).catch((err) =>
        console.error('[audit] login record failed:', err),
      )
      return { token, user: { ...user, tenantId }, role: member.role }
    },
  )
}
