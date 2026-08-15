import type { FastifyInstance } from 'fastify'
import { isMessageContentType, type Message } from '@ta/contracts'
import { requireAuth } from '../middleware.js'
import { isMember, markRead } from '../repos/sessions.js'
import { createMessage, listMessages } from '../repos/messages.js'
import type { Config } from '../config.js'
import pg from 'pg'

const MAX_LIMIT = 100

export function registerMessageRoutes(
  app: FastifyInstance,
  config: Config,
  pool: pg.Pool,
  onMessageCreated: (message: Message) => void,
): void {
  const auth = requireAuth(config)

  app.get<{ Params: { id: string }; Querystring: { after_seq?: string; limit?: string } }>(
    '/api/v1/sessions/:id/messages',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      const userId = request.user!.id
      if (!(await isMember(pool, sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const afterSeq = Math.max(0, Number(request.query.after_seq ?? 0) || 0)
      const limit = Math.min(MAX_LIMIT, Math.max(1, Number(request.query.limit ?? 50) || 50))
      const messages = await listMessages(pool, sessionId, afterSeq, limit)
      return { messages }
    },
  )

  app.post<{ Params: { id: string }; Body: { clientMsgId?: string; contentType?: string; content?: string } }>(
    '/api/v1/sessions/:id/messages',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      const userId = request.user!.id
      if (!(await isMember(pool, sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const clientMsgId = request.body?.clientMsgId?.trim()
      const contentType = request.body?.contentType
      const content = request.body?.content
      if (!clientMsgId || clientMsgId.length > 128) {
        return reply.code(400).send({ error: 'clientMsgId is required (<=128 chars)' })
      }
      if (!contentType || !isMessageContentType(contentType)) {
        return reply.code(400).send({ error: 'contentType is invalid' })
      }
      if (typeof content !== 'string' || content.length === 0 || content.length > 10000) {
        return reply.code(400).send({ error: 'content is required (<=10000 chars)' })
      }
      const { message, created } = await createMessage(pool, {
        sessionId,
        senderId: userId,
        senderKind: 'human',
        contentType,
        content,
        clientMsgId,
      })
      if (created) onMessageCreated(message)
      return reply.code(created ? 201 : 200).send({ message })
    },
  )

  app.post<{ Params: { id: string }; Body: { seq?: number } }>(
    '/api/v1/sessions/:id/read',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      const userId = request.user!.id
      if (!(await isMember(pool, sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const seq = request.body?.seq
      if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
        return reply.code(400).send({ error: 'seq must be a non-negative integer' })
      }
      await markRead(pool, sessionId, userId, seq)
      return reply.code(204).send()
    },
  )
}
