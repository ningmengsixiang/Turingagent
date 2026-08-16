import type { FastifyInstance } from 'fastify'
import type { Message } from '@ta/contracts'
import { requireAuth } from '../middleware.js'
import { isMember } from '../repos/sessions.js'
import { createMessage, updateMessageContent } from '../repos/messages.js'
import { createApproval, decideApproval, ApprovalStateError } from '../repos/approvals.js'
import { recordAudit } from '../repos/audit.js'
import type { Config } from '../config.js'
import pg from 'pg'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerApprovalRoutes(
  app: FastifyInstance,
  config: Config,
  pool: pg.Pool,
  emitMessageCreated: (message: Message) => void,
  emitMessageUpdated: (message: Message) => void,
): void {
  const auth = requireAuth(config, pool)

  app.post<{ Params: { id: string }; Body: { title?: string; description?: string; approverId?: string } }>(
    '/api/v1/sessions/:id/approvals',
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
      try {
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
      } catch (err) {
        // 补偿（T2 质量审查 M3）：卡片写失败则回删 approval，避免孤儿审批
        console.error('[approval] card creation failed, compensating:', err)
        await pool.query('DELETE FROM approvals WHERE id = $1', [approval.id])
        throw err
      }
    },
  )

  app.post<{ Params: { id: string }; Body: { decision?: string; reason?: string } }>(
    '/api/v1/approvals/:id/decide',
    { preHandler: auth },
    async (request, reply) => {
      const approvalId = request.params.id
      if (!UUID_PATTERN.test(approvalId)) {
        return reply.code(400).send({ error: 'approval id must be a uuid' })
      }
      const userId = request.user!.id
      const decision = request.body?.decision
      if (decision !== 'approved' && decision !== 'rejected') {
        return reply.code(400).send({ error: 'decision must be approved|rejected' })
      }
      try {
        const approval = await decideApproval(pool, {
          id: approvalId,
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
        void recordAudit(pool, {
          actorId: userId,
          action: 'approval.decided',
          target: approval.id,
          detail: { decision: approval.status, title: approval.title },
        }).catch((err) => console.error('[audit] decision record failed:', err))
        return { approval }
      } catch (err) {
        if (err instanceof ApprovalStateError) {
          // 错误码映射：NOT_FOUND→404、NOT_APPROVER→403、ALREADY_DECIDED→409（T2 质量审查 M1）
          const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'NOT_APPROVER' ? 403 : 409
          return reply.code(status).send({ error: err.message })
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
