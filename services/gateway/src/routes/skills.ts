import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware.js'
import { isMember } from '../repos/sessions.js'
import { listSkills, getSkill } from '../repos/skills.js'
import { recordAudit } from '../repos/audit.js'
import pg from 'pg'
import type { Config } from '../config.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerSkillRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const auth = requireAuth(config, pool)

  // 技能包列表（热加载）
  app.get('/api/v1/skills', { preHandler: auth }, async () => {
    return { skills: listSkills() }
  })

  // 会话绑定技能包（记录到 audit；绑定关系后续用于工具白名单下发）
  app.post<{ Params: { id: string }; Body: { skillId?: string } }>(
    '/api/v1/sessions/:id/skills',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      if (!UUID_PATTERN.test(sessionId)) {
        return reply.code(400).send({ error: 'session id must be a uuid' })
      }
      const skillId = request.body?.skillId?.trim()
      if (!skillId) return reply.code(400).send({ error: 'skillId is required' })
      if (!getSkill(skillId)) return reply.code(400).send({ error: `skill ${skillId} not found` })
      if (!(await isMember(pool, sessionId, request.user!.id))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'session.skill_bound',
        target: sessionId,
        detail: { skillId },
      }).catch((err) => console.error('[audit] skill bind failed:', err))
      return { bound: true, skill: getSkill(skillId) }
    },
  )
}
