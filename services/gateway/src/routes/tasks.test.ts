import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'
import { listMessages } from '../repos/messages.js'

describe('task routes', () => {
  let built: BuiltApp
  let pool: pg.Pool

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
    built = await buildApp({ databaseUrl: 'postgres://ta:ta@localhost:5432/ta_dev' })
  })
  afterEach(async () => {
    await built.app.close()
  })

  async function loginAs(username: string): Promise<string> {
    const res = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username } })
    return res.json().token as string
  }

  async function createProjectSession(token: string): Promise<string> {
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    return res.json().session.id as string
  }

  it('creates a task with a card message', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/tasks`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '支付网关对接', assigneeId: 'agent-ta-fullstack', assigneeKind: 'agent' },
    })
    expect(res.statusCode).toBe(201)
    const { task, cardMessage } = res.json()
    expect(task.status).toBe('todo')
    expect(cardMessage.contentType).toBe('task_card')
    expect(cardMessage.ref).toEqual({ kind: 'task', id: task.id })
    const messages = await listMessages(pool, sessionId, 0, 10)
    expect(messages.some((m) => m.contentType === 'task_card')).toBe(true)
  })

  it('transitions status and updates the card', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/tasks`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '支付网关对接', assigneeId: 'u-bob', assigneeKind: 'human' },
    })
    const taskId = created.json().task.id as string
    const updated = await built.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}/status`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { status: 'in_progress' },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().task.status).toBe('in_progress')
    const messages = await listMessages(pool, sessionId, 0, 10)
    const card = messages.find((m) => m.contentType === 'task_card')!
    expect(card.content).toContain('进行中')
  })

  it('lists tasks for the session kanban', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/tasks`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '任务一', assigneeId: 'u-bob', assigneeKind: 'human' },
    })
    const res = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/tasks`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().tasks).toHaveLength(1)
  })

  it('rejects invalid status with 400', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/tasks`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '任务', assigneeId: 'u-bob', assigneeKind: 'human' },
    })
    const taskId = created.json().task.id as string
    const res = await built.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}/status`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { status: 'cancelled' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an invalid dueAt with 400', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/tasks`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '任务', assigneeId: 'u-bob', assigneeKind: 'human', dueAt: 'not-a-date' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a non-member status transition with 403', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/tasks`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '任务', assigneeId: 'u-bob', assigneeKind: 'human' },
    })
    const taskId = created.json().task.id as string
    const carol = await loginAs('carol')
    const res = await built.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}/status`,
      headers: { authorization: `Bearer ${carol}` },
      payload: { status: 'in_progress' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejects a loose date string like 2026 with 400', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/tasks`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '任务', assigneeId: 'u-bob', assigneeKind: 'human', dueAt: '2026' },
    })
    expect(res.statusCode).toBe(400)
  })
})
