import type { FastifyInstance } from 'fastify'
import type { Message } from '@ta/contracts'
import { requireAuth } from '../middleware.js'
import { isMember } from '../repos/sessions.js'
import { createMessage, updateMessageContent } from '../repos/messages.js'
import { createApproval, decideApproval, ApprovalStateError } from '../repos/approvals.js'
import type { Config } from '../config.js'
import pg from 'pg'

export function registerApprovalRoutes(
  app: FastifyInstance,
  config: Config,
  pool: pg.Pool,
  emitMessageCreated: (message: Message) => void,
  emitMessageUpdated: (message: Message) => void,
): void {
  const auth = requireAuth(config)

  app.post<{ Params: { id: string }; Body: { title?: string; description?: string; approverId?: string } }>(
    '/api/v1/sessions/:id/approvals',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      const userId = request.user!.id
      if (!(await isMember(pool, sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const title = request.body?.title?.trim()
      const approverId = request.body?.approverId?.trim()
      if (!title || title.length > 200) {
        return reply.code(400).send({ error: 'title is required (<=200 chars)' })
      }
      if (!approverId) {
        return reply.code(400).send({ error: 'approverId is required' })
      }
      if (!(await isMember(pool, sessionId, approverId))) {
        return reply.code(400).send({ error: 'approver must be a member of this session' })
      }
      const approval = await createApproval(pool, {
        sessionId,
        title,
        description: request.body?.description?.trim() || undefined,
        approverId,
        createdBy: userId,
      })
      // 审批卡片消息（PR-1：人类审批闸门的会话内载体）
      const { message } = await createMessage(pool, {
        sessionId,
        senderId: userId,
        senderKind: 'human',
        contentType: 'confirmation_card',
        content: `待审批：${approval.title}`,
        clientMsgId: `approval-card-${approval.id}`,
        ref: { kind: 'approval', id: approval.id },
      })
      emitMessageCreated(message)
      return reply.code(201).send({ approval, cardMessage: message })
    },
  )

  app.post<{ Params: { id: string }; Body: { decision?: string; reason?: string } }>(
    '/api/v1/approvals/:id/decide',
    { preHandler: auth },
    async (request, reply) => {
      const userId = request.user!.id
      const decision = request.body?.decision
      if (decision !== 'approved' && decision !== 'rejected') {
        return reply.code(400).send({ error: 'decision must be approved|rejected' })
      }
      try {
        const approval = await decideApproval(pool, {
          id: request.params.id,
          approverId: userId,
          decision,
          reason: request.body?.reason?.trim() || undefined,
        })
        // 更新卡片消息内容（状态经 message.updated 广播）
        const cardId = await findCardMessageId(pool, approval.id)
        if (cardId) {
          const suffix = approval.reason ? `（${approval.reason}）` : ''
          const updated = await updateMessageContent(
            pool,
            cardId,
            approval.status === 'approved'
              ? `✅ 已通过：${approval.title}${suffix}`
              : `❌ 已驳回：${approval.title}${suffix}`,
          )
          if (updated) emitMessageUpdated(updated)
        }
        return { approval }
      } catch (err) {
        if (err instanceof ApprovalStateError) {
          return reply.code(409).send({ error: err.message })
        }
        throw err
      }
    },
  )
}

async function findCardMessageId(pool: pg.Pool, approvalId: string): Promise<string | null> {
  const res = await pool.query<{ id: string }>(
    'SELECT id FROM messages WHERE ref_kind = $1 AND ref_id = $2 ORDER BY seq ASC LIMIT 1',
    ['approval', approvalId],
  )
  return res.rows[0]?.id ?? null
}
