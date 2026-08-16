import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware.js'
import { isMember } from '../repos/sessions.js'
import { createMemory, getMemory, listMemoriesForSession, updateMemoryContent, listMemoryVersions } from '../repos/memories.js'
import type { Config } from '../config.js'
import pg from 'pg'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerMemoryRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const auth = requireAuth(config, pool)

  app.get<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/memories',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      if (!UUID_PATTERN.test(sessionId)) {
        return reply.code(400).send({ error: 'session id must be a uuid' })
      }
      const userId = request.user!.id
      if (!(await isMember(pool, sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const memories = await listMemoriesForSession(pool, sessionId)
      return { memories }
    },
  )

  app.post<{ Params: { id: string }; Body: { title?: string; content?: string } }>(
    '/api/v1/sessions/:id/memories',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      if (!UUID_PATTERN.test(sessionId)) {
        return reply.code(400).send({ error: 'session id must be a uuid' })
      }
      const userId = request.user!.id
      if (!(await isMember(pool, sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const title = request.body?.title?.trim()
      const content = request.body?.content?.trim()
      if (!title || title.length > 200) {
        return reply.code(400).send({ error: 'title is required (<=200 chars)' })
      }
      if (!content || content.length > 20000) {
        return reply.code(400).send({ error: 'content is required (<=20000 chars)' })
      }
      const memory = await createMemory(pool, { sessionId, title, content, createdBy: userId })
      return reply.code(201).send({ memory })
    },
  )

  app.put<{ Params: { id: string }; Body: { title?: string; content?: string } }>(
    '/api/v1/memories/:id',
    { preHandler: auth },
    async (request, reply) => {
      const memoryId = request.params.id
      if (!UUID_PATTERN.test(memoryId)) {
        return reply.code(400).send({ error: 'memory id must be a uuid' })
      }
      const userId = request.user!.id
      const memory = await getMemory(pool, memoryId)
      if (!memory) return reply.code(404).send({ error: 'memory not found' })
      if (!(await isMember(pool, memory.sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of the memory session' })
      }
      const content = request.body?.content?.trim()
      if (!content || content.length > 20000) {
        return reply.code(400).send({ error: 'content is required (<=20000 chars)' })
      }
      const title = request.body?.title?.trim()
      const updated = await updateMemoryContent(pool, { id: memoryId, title, content, editedBy: userId })
      return { memory: updated }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/v1/memories/:id/versions',
    { preHandler: auth },
    async (request, reply) => {
      const memoryId = request.params.id
      if (!UUID_PATTERN.test(memoryId)) {
        return reply.code(400).send({ error: 'memory id must be a uuid' })
      }
      const userId = request.user!.id
      const memory = await getMemory(pool, memoryId)
      if (!memory) return reply.code(404).send({ error: 'memory not found' })
      if (!(await isMember(pool, memory.sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of the memory session' })
      }
      const versions = await listMemoryVersions(pool, memoryId)
      return { versions }
    },
  )
}
