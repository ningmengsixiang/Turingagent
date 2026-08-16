import type { FastifyInstance } from 'fastify'
import type { Message } from '@ta/contracts'
import { isApprovalNodeMode } from '@ta/contracts'
import { requireAuth } from '../middleware.js'
import { isMember } from '../repos/sessions.js'
import { canAccessSession } from '../repos/access.js'
import { createMessage, updateMessageContent } from '../repos/messages.js'
import {
  createApproval,
  getApproval,
  decideApproval,
  transferApproval,
  returnApproval,
  resubmitApproval,
  cancelApproval,
  escalateOverdueApprovals,
  ApprovalStateError,
} from '../repos/approvals.js'
import { recordAudit } from '../repos/audit.js'
import type { Config } from '../config.js'
import pg from 'pg'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_NODES = 10

/** 统一错误码映射（T3 质量审查 S4）：NOT_FOUND→404、AGENT_NOT_ALLOWED→400、NOT_APPROVER/NOT_OWNER→403、其余（ALREADY_DECIDED/NOT_PENDING）→409 */
function approvalErrorStatus(err: ApprovalStateError): number {
  switch (err.code) {
    case 'NOT_FOUND':
      return 404
    case 'AGENT_NOT_ALLOWED':
      return 400
    case 'NOT_APPROVER':
    case 'NOT_OWNER':
      return 403
    default:
      return 409
  }
}

export function registerApprovalRoutes(
  app: FastifyInstance,
  config: Config,
  pool: pg.Pool,
  emitMessageCreated: (message: Message) => void,
  emitMessageUpdated: (message: Message) => void,
): void {
  const auth = requireAuth(config, pool)

  app.post<{ Params: { id: string }; Body: { title?: string; description?: string; approverId?: string; nodes?: Array<{ mode?: string; approverIds?: string[] }> } }>(
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
      if (!title || title.length > 200) {
        return reply.code(400).send({ error: 'title is required (<=200 chars)' })
      }
      const nodes = request.body?.nodes
      if (nodes !== undefined) {
        if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > MAX_NODES) {
          return reply.code(400).send({ error: `nodes must be an array of 1-${MAX_NODES} items` })
        }
        for (const [i, n] of nodes.entries()) {
          if (!n || !isApprovalNodeMode(n.mode) || !Array.isArray(n.approverIds) || n.approverIds.length === 0) {
            return reply.code(400).send({ error: `node ${i} needs mode and non-empty approverIds` })
          }
          for (const a of n.approverIds) {
            if (!(await isMember(pool, sessionId, a))) {
              return reply.code(400).send({ error: `node ${i} approver ${a} is not a member of this session` })
            }
          }
        }
      }
      const approverId = request.body?.approverId?.trim()
      if (nodes === undefined && !approverId) {
        return reply.code(400).send({ error: 'approverId is required when nodes is absent' })
      }
      if (approverId && !(await isMember(pool, sessionId, approverId))) {
        return reply.code(400).send({ error: 'approver must be a member of this session' })
      }
      let approval: Awaited<ReturnType<typeof createApproval>>
      try {
        approval = await createApproval(pool, {
          sessionId,
          title,
          description: request.body?.description?.trim() || undefined,
          approverId,
          nodes: nodes?.map((n) => ({ mode: n.mode! as 'single' | 'all' | 'any', approverIds: n.approverIds! })),
          createdBy: userId,
        })
      } catch (err) {
        // AGENT_NOT_ALLOWED：agent 只有建议权（PRD）→ 400（T2 质量审查 #2）
        if (err instanceof ApprovalStateError && err.code === 'AGENT_NOT_ALLOWED') {
          return reply.code(400).send({ error: err.message })
        }
        throw err
      }
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

  app.get<{ Params: { id: string } }>(
    '/api/v1/approvals/:id',
    { preHandler: auth },
    async (request, reply) => {
      const approvalId = request.params.id
      if (!UUID_PATTERN.test(approvalId)) {
        return reply.code(400).send({ error: 'approval id must be a uuid' })
      }
      const approval = await getApproval(pool, approvalId)
      if (!approval) return reply.code(404).send({ error: 'approval not found' })
      if (!(await canAccessSession(pool, approval.sessionId, request.user!.id))) {
        return reply.code(403).send({ error: 'not a member of the approval session' })
      }
      return { approval }
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
        try {
          // 尽力而为（T3 质量审查 S2）：卡片更新失败不污染 mutation 响应
          await updateCard(pool, approvalId, approval.status, approval.reason, approval.title, emitMessageUpdated)
        } catch (err) {
          console.error('[approval] card update failed:', err)
        }
        void recordAudit(pool, {
          actorId: userId,
          action: 'approval.decided',
          target: approval.id,
          // 审计记录实际投票（T3 质量审查 S3）：decision=请求原始投票，status=结果状态
          detail: { decision, status: approval.status, nodeIndex: approval.currentNodeIndex, title: approval.title },
        }).catch((err) => console.error('[audit] decision record failed:', err))
        return { approval }
      } catch (err) {
        if (err instanceof ApprovalStateError) {
          return reply.code(approvalErrorStatus(err)).send({ error: err.message })
        }
        throw err
      }
    },
  )

  app.post<{ Params: { id: string }; Body: { newApproverId?: string } }>(
    '/api/v1/approvals/:id/transfer',
    { preHandler: auth },
    async (request, reply) => {
      const approvalId = request.params.id
      if (!UUID_PATTERN.test(approvalId)) {
        return reply.code(400).send({ error: 'approval id must be a uuid' })
      }
      const newApproverId = request.body?.newApproverId?.trim()
      if (!newApproverId) {
        return reply.code(400).send({ error: 'newApproverId is required' })
      }
      // S1（T3 质量审查）：newApproverId 必须是会话成员；approval 不存在 → 404 优先于成员校验
      const existing = await getApproval(pool, approvalId)
      if (!existing) return reply.code(404).send({ error: 'approval not found' })
      if (!(await isMember(pool, existing.sessionId, newApproverId))) {
        return reply.code(400).send({ error: 'newApproverId must be a member of the approval session' })
      }
      try {
        const approval = await transferApproval(pool, { id: approvalId, operatorId: request.user!.id, newApproverId })
        void recordAudit(pool, {
          actorId: request.user!.id,
          action: 'approval.transferred',
          target: approval.id,
          detail: { newApproverId, title: approval.title },
        }).catch((err) => console.error('[audit] transfer record failed:', err))
        return { approval }
      } catch (err) {
        if (err instanceof ApprovalStateError) {
          return reply.code(approvalErrorStatus(err)).send({ error: err.message })
        }
        throw err
      }
    },
  )

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/v1/approvals/:id/return',
    { preHandler: auth },
    async (request, reply) => {
      const approvalId = request.params.id
      if (!UUID_PATTERN.test(approvalId)) {
        return reply.code(400).send({ error: 'approval id must be a uuid' })
      }
      const reason = request.body?.reason?.trim()
      if (!reason) {
        return reply.code(400).send({ error: 'reason is required for return' })
      }
      try {
        const approval = await returnApproval(pool, { id: approvalId, operatorId: request.user!.id, reason })
        try {
          // 尽力而为（T3 质量审查 S2）
          await updateCard(pool, approvalId, approval.status, approval.reason, approval.title, emitMessageUpdated)
        } catch (err) {
          console.error('[approval] card update failed:', err)
        }
        void recordAudit(pool, {
          actorId: request.user!.id,
          action: 'approval.returned',
          target: approval.id,
          detail: { reason, title: approval.title },
        }).catch((err) => console.error('[audit] return record failed:', err))
        return { approval }
      } catch (err) {
        if (err instanceof ApprovalStateError) {
          return reply.code(approvalErrorStatus(err)).send({ error: err.message })
        }
        throw err
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/v1/approvals/:id/resubmit',
    { preHandler: auth },
    async (request, reply) => {
      const approvalId = request.params.id
      if (!UUID_PATTERN.test(approvalId)) {
        return reply.code(400).send({ error: 'approval id must be a uuid' })
      }
      try {
        const approval = await resubmitApproval(pool, { id: approvalId, operatorId: request.user!.id })
        try {
          // 尽力而为（T3 质量审查 S2）
          await updateCard(pool, approvalId, approval.status, undefined, approval.title, emitMessageUpdated)
        } catch (err) {
          console.error('[approval] card update failed:', err)
        }
        void recordAudit(pool, {
          actorId: request.user!.id,
          action: 'approval.resubmitted',
          target: approval.id,
          detail: { version: approval.version, title: approval.title },
        }).catch((err) => console.error('[audit] resubmit record failed:', err))
        return { approval }
      } catch (err) {
        if (err instanceof ApprovalStateError) {
          return reply.code(approvalErrorStatus(err)).send({ error: err.message })
        }
        throw err
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/v1/approvals/:id/cancel',
    { preHandler: auth },
    async (request, reply) => {
      const approvalId = request.params.id
      if (!UUID_PATTERN.test(approvalId)) {
        return reply.code(400).send({ error: 'approval id must be a uuid' })
      }
      try {
        const approval = await cancelApproval(pool, { id: approvalId, operatorId: request.user!.id })
        try {
          // 尽力而为（T3 质量审查 S2）
          await updateCard(pool, approvalId, approval.status, undefined, approval.title, emitMessageUpdated)
        } catch (err) {
          console.error('[approval] card update failed:', err)
        }
        void recordAudit(pool, {
          actorId: request.user!.id,
          action: 'approval.cancelled',
          target: approval.id,
          detail: { title: approval.title },
        }).catch((err) => console.error('[audit] cancel record failed:', err))
        return { approval }
      } catch (err) {
        if (err instanceof ApprovalStateError) {
          return reply.code(approvalErrorStatus(err)).send({ error: err.message })
        }
        throw err
      }
    },
  )

  // 手动触发超时升级（供外部调度/演示调用；自动定时器记 Phase 2 后续）
  app.post<{ Params: { id: string } }>(
    '/api/v1/approvals/:id/escalate',
    { preHandler: auth },
    async (request, reply) => {
      const approvalId = request.params.id
      if (!UUID_PATTERN.test(approvalId)) {
        return reply.code(400).send({ error: 'approval id must be a uuid' })
      }
      const approval = await getApproval(pool, approvalId)
      if (!approval) return reply.code(404).send({ error: 'approval not found' })
      if (approval.status !== 'pending') {
        return reply.code(409).send({ error: `approval is ${approval.status}, cannot escalate` })
      }
      if (!(await isMember(pool, approval.sessionId, request.user!.id))) {
        return reply.code(403).send({ error: 'not a member of the approval session' })
      }
      const escalated = await escalateOverdueApprovals(pool)
      const mine = escalated.find((a) => a.id === approvalId)
      if (!mine) {
        return reply.code(409).send({ error: 'approval is not overdue yet' })
      }
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'approval.escalated',
        target: approval.id,
        detail: { escalatedCount: mine.escalatedCount, title: mine.title },
      }).catch((err) => console.error('[audit] escalate record failed:', err))
      return { approval: mine }
    },
  )
}

async function updateCard(
  pool: pg.Pool,
  approvalId: string,
  status: string,
  reason: string | undefined,
  title: string,
  emitMessageUpdated: (message: Message) => void,
): Promise<void> {
  const cardId = await findCardMessageId(pool, approvalId)
  if (!cardId) return
  const suffix = reason ? `（${reason}）` : ''
  const prefix =
    status === 'approved' ? '✅ 已通过' : status === 'rejected' ? '❌ 已驳回' : status === 'returned' ? '↩️ 已退回修改' : status === 'cancelled' ? '⛔ 已撤销' : '待审批'
  const updated = await updateMessageContent(pool, cardId, `${prefix}：${title}${suffix}`)
  if (updated) emitMessageUpdated(updated)
}

async function findCardMessageId(pool: pg.Pool, approvalId: string): Promise<string | null> {
  const res = await pool.query<{ id: string }>(
    'SELECT id FROM messages WHERE ref_kind = $1 AND ref_id = $2 ORDER BY seq ASC LIMIT 1',
    ['approval', approvalId],
  )
  return res.rows[0]?.id ?? null
}
