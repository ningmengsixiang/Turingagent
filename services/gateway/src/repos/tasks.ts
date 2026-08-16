import pg from 'pg'
import type { Task, TaskStatus } from '@ta/contracts'
import { AGENT_DISPLAY_NAMES } from '../agent/registry.js'

export interface TaskRow {
  id: string
  session_id: string
  title: string
  assignee_id: string
  assignee_kind: string
  status: string
  due_at: Date | null
  created_by: string
  created_at: Date
}

export function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    assigneeId: row.assignee_id,
    assigneeKind: row.assignee_kind as 'human' | 'agent',
    status: row.status as TaskStatus,
    dueAt: row.due_at?.toISOString(),
  }
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '📋 待开始',
  in_progress: '🔄 进行中',
  blocked: '⛔ 已阻塞',
  done: '✅ 已完成',
}

export function taskCardContent(task: Task): string {
  // agent 显示名复用注册表（单一事实来源，避免小写 id 直接展示）
  const assignee =
    task.assigneeKind === 'agent' ? `@${AGENT_DISPLAY_NAMES[task.assigneeId] ?? task.assigneeId}` : task.assigneeId
  return `${STATUS_LABEL[task.status]}：${task.title}（负责人 ${assignee}）`
}

export class TaskStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskStateError'
  }
}

export async function createTask(
  pool: pg.Pool,
  input: {
    sessionId: string
    title: string
    assigneeId: string
    assigneeKind: 'human' | 'agent'
    dueAt?: string
    createdBy: string
  },
): Promise<Task> {
  const res = await pool.query<TaskRow>(
    `INSERT INTO tasks (session_id, title, assignee_id, assignee_kind, due_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.sessionId, input.title, input.assigneeId, input.assigneeKind, input.dueAt ?? null, input.createdBy],
  )
  return mapTask(res.rows[0]!)
}

export async function getTask(pool: pg.Pool, id: string): Promise<Task | null> {
  const res = await pool.query<TaskRow>('SELECT * FROM tasks WHERE id = $1', [id])
  return res.rows[0] ? mapTask(res.rows[0]) : null
}

export async function listTasksForSession(pool: pg.Pool, sessionId: string): Promise<Task[]> {
  const res = await pool.query<TaskRow>('SELECT * FROM tasks WHERE session_id = $1 ORDER BY created_at ASC', [sessionId])
  return res.rows.map(mapTask)
}

export async function updateTaskStatus(
  pool: pg.Pool,
  input: { id: string; status: TaskStatus },
): Promise<Task> {
  const res = await pool.query<TaskRow>(
    `UPDATE tasks SET status = $2 WHERE id = $1 RETURNING *`,
    [input.id, input.status],
  )
  if (!res.rows[0]) throw new TaskStateError('task not found')
  return mapTask(res.rows[0]!)
}
