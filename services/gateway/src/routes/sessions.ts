import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware.js'
import { createSession, getSessionById, isMember, listSessionMembers, listSessionsVisible } from '../repos/sessions.js'
import { canAccessSession } from '../repos/access.js'
import type { Config } from '../config.js'
import pg from 'pg'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerSessionRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const auth = requireAuth(config, pool)

  app.post<{ Body: { kind?: string; title?: string; memberIds?: string[]; departmentId?: string } }>(
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
      if (!Array.isArray(memberIds) || memberIds.length === 0 || memberIds.length > 100) {
        return reply.code(400).send({ error: 'memberIds must be a non-empty array (<=100)' })
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
      const userId = request.user!.id
      const session = await createSession(pool, {
        kind,
        title,
        memberIds: [...new Set([userId, ...memberIds])],
      })
      if (departmentId) {
        await pool.query('UPDATE sessions SET department_id = $1 WHERE id = $2', [departmentId, session.id])
      }
      return reply.code(201).send({ session: departmentId ? { ...session, departmentId } : session })
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
    if (!(await isMember(pool, sessionId, userId))) {
      return reply.code(403).send({ error: 'not a member of this session' })
    }
    const members = await listSessionMembers(pool, sessionId)
    return { members }
  })
}
