import type { FastifyInstance } from 'fastify'
import type { Message, TaskStatus } from '@ta/contracts'
import { requireAuth } from '../middleware.js'
import { isMember } from '../repos/sessions.js'
import { createMessage, updateMessageContent } from '../repos/messages.js'
import { createTask, getTask, listTasksForSession, updateTaskStatus, taskCardContent, TaskStateError } from '../repos/tasks.js'
import type { Config } from '../config.js'
import pg from 'pg'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done']

function isIsoDate(value: string): boolean {
  // 严格 ISO-8601：正则拦形状 + Date.UTC 校验日历合法性，避免 Date.parse 宽松解析与 PG 失配
  const m = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

export function registerTaskRoutes(
  app: FastifyInstance,
  config: Config,
  pool: pg.Pool,
  emitMessageCreated: (message: Message) => void,
  emitMessageUpdated: (message: Message) => void,
): void {
  const auth = requireAuth(config, pool)

  app.post<{ Params: { id: string }; Body: { title?: string; assigneeId?: string; assigneeKind?: string; dueAt?: string } }>(
    '/api/v1/sessions/:id/tasks',
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
      const assigneeId = request.body?.assigneeId?.trim()
      const assigneeKind = request.body?.assigneeKind
      const dueAt = request.body?.dueAt
      if (!title || title.length > 200) {
        return reply.code(400).send({ error: 'title is required (<=200 chars)' })
      }
      if (!assigneeId) {
        return reply.code(400).send({ error: 'assigneeId is required' })
      }
      if (assigneeKind !== 'human' && assigneeKind !== 'agent') {
        return reply.code(400).send({ error: 'assigneeKind must be human|agent' })
      }
      if (dueAt !== undefined && !isIsoDate(dueAt)) {
        return reply.code(400).send({ error: 'dueAt must be a valid ISO date' })
      }
      const task = await createTask(pool, {
        sessionId,
        title,
        assigneeId,
        assigneeKind,
        dueAt,
        createdBy: userId,
      })
      try {
        const { message } = await createMessage(pool, {
          sessionId,
          senderId: userId,
          senderKind: 'human',
          contentType: 'task_card',
          content: taskCardContent(task),
          clientMsgId: `task-card-${task.id}`,
          ref: { kind: 'task', id: task.id },
        })
        emitMessageCreated(message)
        return reply.code(201).send({ task, cardMessage: message })
      } catch (err) {
        console.error('[task] card creation failed, compensating:', err)
        await pool.query('DELETE FROM tasks WHERE id = $1', [task.id])
        throw err
      }
    },
  )

  app.patch<{ Params: { id: string }; Body: { status?: string } }>(
    '/api/v1/tasks/:id/status',
    { preHandler: auth },
    async (request, reply) => {
      const taskId = request.params.id
      if (!UUID_PATTERN.test(taskId)) {
        return reply.code(400).send({ error: 'task id must be a uuid' })
      }
      const userId = request.user!.id
      const status = request.body?.status as TaskStatus | undefined
      if (!status || !STATUSES.includes(status)) {
        return reply.code(400).send({ error: 'status must be todo|in_progress|blocked|done' })
      }
      try {
        const existing = await getTask(pool, taskId)
        if (!existing) throw new TaskStateError('task not found')
        if (!(await isMember(pool, existing.sessionId, userId))) {
          return reply.code(403).send({ error: 'not a member of the task session' })
        }
        const task = await updateTaskStatus(pool, { id: taskId, status })
        const cardId = await findTaskCardId(pool, task.id)
        if (cardId) {
          const updated = await updateMessageContent(pool, cardId, taskCardContent(task))
          if (updated) emitMessageUpdated(updated)
        }
        return { task }
      } catch (err) {
        if (err instanceof TaskStateError) {
          return reply.code(404).send({ error: err.message })
        }
        throw err
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/tasks',
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
      const tasks = await listTasksForSession(pool, sessionId)
      return { tasks }
    },
  )
}

async function findTaskCardId(pool: pg.Pool, taskId: string): Promise<string | null> {
  const res = await pool.query<{ id: string }>(
    'SELECT id FROM messages WHERE ref_kind = $1 AND ref_id = $2 ORDER BY seq ASC LIMIT 1',
    ['task', taskId],
  )
  return res.rows[0]?.id ?? null
}
