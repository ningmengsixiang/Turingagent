import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware.js'
import { createSession, getSessionById, isMember, listSessionMembers, listSessionsVisible } from '../repos/sessions.js'
import { canAccessSession } from '../repos/access.js'
import { getTemplate } from '../repos/templates.js'
import { recordAudit } from '../repos/audit.js'
import type { Config } from '../config.js'
import pg from 'pg'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerSessionRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const auth = requireAuth(config, pool)

  app.post<{ Body: { kind?: string; title?: string; memberIds?: string[]; departmentId?: string; templateId?: string } }>(
    '/api/v1/sessions',
    { preHandler: auth },
    async (request, reply) => {
      const kind = request.body?.kind
      const title = request.body?.title?.trim()
      const memberIds = request.body?.memberIds
      const departmentId = request.body?.departmentId?.trim()
      if (kind !== 'direct' && kind !== 'project' && kind !== 'group') {
        return reply.code(400).send({ error: 'kind must be direct|project|group' })
      }
      if (!title || title.length > 200) {
        return reply.code(400).send({ error: 'title is required (<=200 chars)' })
      }
      // 允许空 memberIds：创建者自动加入（createSession 内 [...new Set([userId, ...memberIds])]）
      if (!Array.isArray(memberIds) || memberIds.length > 100) {
        return reply.code(400).send({ error: 'memberIds must be an array (<=100)' })
      }
      if (!memberIds.every((m) => typeof m === 'string' && m.length > 0 && m.length <= 128)) {
        return reply.code(400).send({ error: 'memberIds must contain non-empty strings (<=128 chars)' })
      }
      // ABAC：可选 departmentId（项目归属部门）；提供则校验存在并写入 department_id
      if (departmentId !== undefined && departmentId.length === 0) {
        return reply.code(400).send({ error: 'departmentId must be a non-empty uuid' })
      }
      if (departmentId) {
        if (!UUID_PATTERN.test(departmentId)) {
          return reply.code(400).send({ error: 'departmentId must be a uuid' })
        }
        const dept = await pool.query<{ id: string }>('SELECT id FROM departments WHERE id = $1', [departmentId])
        if (dept.rows.length === 0) return reply.code(400).send({ error: 'department not found' })
      }
      // 跨租户成员校验（补计划 21 缺口）：已有租户的成员若与创建者租户不同 → 拒绝
      if (memberIds.length > 0 && request.user!.tenantId) {
        const members = await pool.query<{ user_id: string; tenant_id: string | null }>(
          `SELECT user_id, tenant_id FROM users WHERE user_id = ANY($1::text[])`,
          [memberIds],
        )
        for (const m of members.rows) {
          if (m.tenant_id && m.tenant_id !== request.user!.tenantId) {
            return reply.code(400).send({ error: `member ${m.user_id} is in a different tenant` })
          }
        }
      }
      // 项目模板：可选 templateId（存在性校验；套用 = 创建成功后绑定模板技能包）
      const templateId = request.body?.templateId?.trim()
      const template = templateId ? getTemplate(templateId) : null
      if (templateId && !template) {
        return reply.code(400).send({ error: 'template not found' })
      }
      const userId = request.user!.id
      const session = await createSession(pool, {
        kind,
        title,
        memberIds: [...new Set([userId, ...memberIds])],
        // 多租户：会话继承创建者租户（middleware 挂 request.user.tenantId）
        tenantId: request.user!.tenantId,
        // 项目模板：持久化 templateId（迁移 016；查询经 mapSession 返回）
        templateId: template?.id,
      })
      if (departmentId) {
        await pool.query('UPDATE sessions SET department_id = $1 WHERE id = $2', [departmentId, session.id])
      }
      if (template) {
        for (const skillId of template.skillIds) {
          void recordAudit(pool, {
            actorId: userId,
            action: 'session.skill_bound',
            target: session.id,
            detail: { skillId },
          }).catch((err) => console.error('[audit] skill bind failed:', err))
        }
      }
      return reply.code(201).send(
        template
          ? { session: { ...session, ...(departmentId ? { departmentId } : {}), templateId }, template }
          : { session: departmentId ? { ...session, departmentId } : session },
      )
    },
  )

  app.get('/api/v1/sessions', { preHandler: auth }, async (request) => {
    const userId = request.user!.id
    const sessions = await listSessionsVisible(pool, userId)
    return { sessions }
  })

  app.get('/api/v1/sessions/:id', { preHandler: auth }, async (request, reply) => {
    const sessionId = (request.params as { id: string }).id
    const userId = request.user!.id
    if (!(await canAccessSession(pool, sessionId, userId))) {
      // 区分 404/403：canAccessSession 对不存在会话恒 false（FK 保证无成员行），必须回查存在性
      const exists = await getSessionById(pool, sessionId)
      if (!exists) return reply.code(404).send({ error: 'session not found' })
      return reply.code(403).send({ error: 'not a member of this session' })
    }
    const session = await getSessionById(pool, sessionId)
    if (!session) return reply.code(404).send({ error: 'session not found' })
    return { session }
  })

  app.get('/api/v1/sessions/:id/members', { preHandler: auth }, async (request, reply) => {
    const sessionId = (request.params as { id: string }).id
    if (!UUID_PATTERN.test(sessionId)) {
      return reply.code(400).send({ error: 'session id must be a uuid' })
    }
    const userId = request.user!.id
    if (!(await isMember(pool, sessionId, userId, request.user!.tenantId))) {
      return reply.code(403).send({ error: 'not a member of this session' })
    }
    const members = await listSessionMembers(pool, sessionId)
    return { members }
  })
}
