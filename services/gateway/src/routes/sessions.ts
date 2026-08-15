import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware.js'
import { createSession, getSessionById, isMember, listSessionsForUser } from '../repos/sessions.js'
import type { Config } from '../config.js'
import pg from 'pg'

export function registerSessionRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const auth = requireAuth(config)

  app.post<{ Body: { kind?: string; title?: string; memberIds?: string[] } }>(
    '/api/v1/sessions',
    { preHandler: auth },
    async (request, reply) => {
      const kind = request.body?.kind
      const title = request.body?.title?.trim()
      const memberIds = request.body?.memberIds
      if (kind !== 'direct' && kind !== 'project' && kind !== 'group') {
        return reply.code(400).send({ error: 'kind must be direct|project|group' })
      }
      if (!title || title.length > 200) {
        return reply.code(400).send({ error: 'title is required (<=200 chars)' })
      }
      if (!Array.isArray(memberIds) || memberIds.length === 0) {
        return reply.code(400).send({ error: 'memberIds must be a non-empty array' })
      }
      const userId = request.user!.id
      const session = await createSession(pool, {
        kind,
        title,
        memberIds: [...new Set([userId, ...memberIds])],
      })
      return reply.code(201).send({ session })
    },
  )

  app.get('/api/v1/sessions', { preHandler: auth }, async (request) => {
    const userId = request.user!.id
    const sessions = await listSessionsForUser(pool, userId)
    return { sessions }
  })

  app.get('/api/v1/sessions/:id', { preHandler: auth }, async (request, reply) => {
    const sessionId = (request.params as { id: string }).id
    const userId = request.user!.id
    if (!(await isMember(pool, sessionId, userId))) {
      // 区分 404/403：isMember 对不存在会话恒 false（FK 保证无成员行），必须回查存在性
      const exists = await getSessionById(pool, sessionId)
      if (!exists) return reply.code(404).send({ error: 'session not found' })
      return reply.code(403).send({ error: 'not a member of this session' })
    }
    const session = await getSessionById(pool, sessionId)
    if (!session) return reply.code(404).send({ error: 'session not found' })
    return { session }
  })
}
