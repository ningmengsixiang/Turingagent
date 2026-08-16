import type { FastifyInstance } from 'fastify'
import { requireAuth, requireRoleFor } from '../middleware.js'
import { getMarketplaceSkill, installSkill, listMarketplaceSkills } from '../repos/marketplace.js'
import { recordAudit } from '../repos/audit.js'
import type { Config } from '../config.js'
import pg from 'pg'

export function registerMarketplaceRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const auth = requireAuth(config, pool)
  const adminOnly = requireRoleFor(config, pool)

  // 市场浏览（登录可见）
  app.get('/api/v1/marketplace/skills', { preHandler: auth }, async () => {
    return { skills: listMarketplaceSkills() }
  })

  // 安装（管理员；路径白名单 + 重名保护 + 审计）
  app.post<{ Params: { id: string }; Body: { force?: boolean } }>(
    '/api/v1/marketplace/skills/:id/install',
    { preHandler: adminOnly },
    async (request, reply) => {
      const id = request.params.id
      if (!/^[a-z0-9-]{1,64}$/.test(id)) {
        return reply.code(400).send({ error: 'invalid skill id' })
      }
      const skill = getMarketplaceSkill(id)
      if (!skill) return reply.code(404).send({ error: 'skill not found in marketplace' })
      try {
        const result = installSkill(id, request.body?.force === true)
        void recordAudit(pool, {
          actorId: request.user!.id,
          action: 'marketplace.installed',
          target: id,
          detail: { overwritten: result.overwritten },
        }).catch((err) => console.error('[audit] install failed:', err))
        return { installed: true, overwritten: result.overwritten, skill }
      } catch (err) {
        if (err instanceof Error && err.message.includes('already installed')) {
          return reply.code(409).send({ error: err.message })
        }
        throw err
      }
    },
  )
}
