import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware.js'
import { isMember } from '../repos/sessions.js'
import { canAccessSession } from '../repos/access.js'
import { createMemory, getMemory, listMemoriesForSession, updateMemoryContent, listMemoryVersions, MemoryStateError } from '../repos/memories.js'
import type { Config } from '../config.js'
import pg from 'pg'
import type { Message } from '@ta/contracts'
import type { ModelProvider } from '../model/provider.js'
import { mapMessage } from '../repos/messages.js'
import { MEMORY_SUMMARY_PROMPT, collectMessagesForSummary, memoryTitleForToday } from '../agent/memory-summary.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerMemoryRoutes(app: FastifyInstance, config: Config, pool: pg.Pool, provider: ModelProvider | null): void {
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
      if (!(await canAccessSession(pool, sessionId, userId))) {
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
      if (title !== undefined && (title.length === 0 || title.length > 200)) {
        return reply.code(400).send({ error: 'title must be 1-200 chars' })
      }
      let updated
      try {
        updated = await updateMemoryContent(pool, { id: memoryId, title, content, editedBy: userId })
      } catch (err) {
        if (err instanceof MemoryStateError) {
          return reply.code(404).send({ error: err.message })
        }
        throw err
      }
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

  app.post<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/memories/summarize',
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
      if (!provider) {
        return reply.code(503).send({ error: 'agent disabled: model provider not configured' })
      }
      const recent = await listRecentTextMessages(pool, sessionId)
      const transcript = collectMessagesForSummary(recent)
      if (!transcript) {
        return reply.code(400).send({ error: 'no text messages to summarize' })
      }
      const completion = await provider.complete(MEMORY_SUMMARY_PROMPT, transcript)
      const title = memoryTitleForToday()
      // 当天已有该标题记忆则更新为新版本，否则新建
      const existing = await findMemoryByTitle(pool, sessionId, title)
      let memory
      if (existing) {
        memory = await updateMemoryContent(pool, { id: existing.id, content: completion.content, editedBy: userId })
      } else {
        memory = await createMemory(pool, { sessionId, title, content: completion.content, createdBy: userId })
      }
      return { memory }
    },
  )
}

async function listRecentTextMessages(pool: pg.Pool, sessionId: string): Promise<Message[]> {
  const res = await pool.query(
    'SELECT * FROM messages WHERE session_id = $1 AND content_type = $2 ORDER BY seq DESC LIMIT 50',
    [sessionId, 'text'],
  )
  return res.rows.reverse().map(mapMessage)
}

async function findMemoryByTitle(pool: pg.Pool, sessionId: string, title: string) {
  const res = await pool.query(
    'SELECT * FROM memories WHERE session_id = $1 AND title = $2 ORDER BY updated_at DESC LIMIT 1',
    [sessionId, title],
  )
  if (!res.rows[0]) return null
  return getMemory(pool, res.rows[0].id)
}
