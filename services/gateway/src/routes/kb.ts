import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware.js'
import { isMember } from '../repos/sessions.js'
import { canAccessSession } from '../repos/access.js'
import { createKbDocument, listKbForSession, searchKb } from '../repos/kb.js'
import { recordAudit } from '../repos/audit.js'
import type { Config } from '../config.js'
import pg from 'pg'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CONTENT = 10_000

export function registerKbRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const auth = requireAuth(config, pool)

  app.post<{ Params: { id: string }; Body: { title?: string; content?: string } }>(
    '/api/v1/sessions/:id/kb',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      if (!UUID_PATTERN.test(sessionId)) {
        return reply.code(400).send({ error: 'session id must be a uuid' })
      }
      const title = request.body?.title?.trim()
      const content = request.body?.content?.trim()
      if (!title || title.length > 200) {
        return reply.code(400).send({ error: 'title is required (<=200 chars)' })
      }
      if (!content || content.length > MAX_CONTENT) {
        return reply.code(400).send({ error: `content is required (<=${MAX_CONTENT} chars)` })
      }
      if (!(await isMember(pool, sessionId, request.user!.id))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const doc = await createKbDocument(pool, {
        sessionId,
        title,
        content,
        createdBy: request.user!.id,
      })
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'kb.created',
        target: doc.id,
        detail: { title: doc.title },
      }).catch((err) => console.error('[audit] kb create failed:', err))
      return reply.code(201).send({ document: doc })
    },
  )

  app.get<{ Params: { id: string }; Querystring: { q?: string } }>(
    '/api/v1/sessions/:id/kb',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      if (!UUID_PATTERN.test(sessionId)) {
        return reply.code(400).send({ error: 'session id must be a uuid' })
      }
      if (!(await canAccessSession(pool, sessionId, request.user!.id))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const q = request.query.q?.trim()
      const documents = q ? await searchKb(pool, sessionId, q) : await listKbForSession(pool, sessionId)
      return { documents }
    },
  )
}
