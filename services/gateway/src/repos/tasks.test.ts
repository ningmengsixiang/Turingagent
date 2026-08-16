import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from './test-helpers.js'
import { createSession } from './sessions.js'
import { createTask, listTasksForSession, updateTaskStatus, TaskStateError, taskCardContent } from './tasks.js'

describe('task repository', () => {
  let pool: pg.Pool
  let sessionId: string

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
    const session = await createSession(pool, { kind: 'project', title: '报销系统', memberIds: ['u-alice', 'u-bob'] })
    sessionId = session.id
  })

  it('creates a task with card content', async () => {
    const task = await createTask(pool, {
      sessionId,
      title: '支付网关对接',
      assigneeId: 'agent-ta-fullstack',
      assigneeKind: 'agent',
      createdBy: 'u-alice',
    })
    expect(task.status).toBe('todo')
    expect(task.assigneeId).toBe('agent-ta-fullstack')
    expect(taskCardContent(task)).toContain('待开始')
    expect(taskCardContent(task)).toContain('Ta-Fullstack')
  })

  it('lists tasks in creation order', async () => {
    await createTask(pool, { sessionId, title: '任务一', assigneeId: 'u-bob', assigneeKind: 'human', createdBy: 'u-alice' })
    await createTask(pool, { sessionId, title: '任务二', assigneeId: 'u-alice', assigneeKind: 'human', createdBy: 'u-bob' })
    const tasks = await listTasksForSession(pool, sessionId)
    expect(tasks).toHaveLength(2)
    expect(tasks[0]!.title).toBe('任务一')
  })

  it('transitions status and throws on unknown task', async () => {
    const task = await createTask(pool, { sessionId, title: '任务', assigneeId: 'u-bob', assigneeKind: 'human', createdBy: 'u-alice' })
    const updated = await updateTaskStatus(pool, { id: task.id, status: 'in_progress' })
    expect(updated.status).toBe('in_progress')
    expect(taskCardContent(updated)).toContain('进行中')
    await expect(updateTaskStatus(pool, { id: '00000000-0000-0000-0000-000000000000', status: 'done' })).rejects.toThrow(
      TaskStateError,
    )
  })
})
