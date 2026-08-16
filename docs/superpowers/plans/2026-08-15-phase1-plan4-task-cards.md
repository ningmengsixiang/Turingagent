# Phase 1 · 计划 4：任务卡（BL-3 轻量闭环）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 BL-3（任务与开发交付线）的 MVP 轻量闭环（PRD：MVP 任务闭环由「任务卡消息 + 确认卡片」支撑）：会话内创建任务（指派给人类或智能体）→ 生成 TaskCard 卡片消息 → 状态流转（todo → in_progress → done/blocked）→ 前端卡片渲染 + 状态操作。

**Architecture:** `004_tasks.sql` 迁移（tasks 表）→ `repos/tasks.ts`（创建任务 + 卡片消息 + 状态机 + 会话看板列表）→ `routes/tasks.ts`（POST /sessions/:id/tasks 创建并生成卡片、PATCH /tasks/:id/status 流转、GET /sessions/:id/tasks 看板）→ 前端 Chat 渲染任务卡（状态标签 + 流转按钮）。契约复用既有 `Task`/`TaskStatus`/`TaskCard`。

**Tech Stack:** 既有（Fastify + pg + vitest + React）；任务状态机四态（todo/in_progress/blocked/done，契约已定义）；无新依赖。

**决策记录：** 任务创建即生成 TaskCard 卡片消息（content = `任务：<title>`，ref = {kind:'task', id}），状态流转更新卡片内容（`🔄 进行中：…` 等）并 emit `message.updated`（复用审批卡片的 WS 链路）；任务执行者可为人类或智能体（assigneeKind）；MVP 不建看板页（看板 = GET 任务列表 + 前端卡片分组，Phase 2 做完整看板拖拽）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/migrations/004_tasks.sql` | 创建 | tasks 表 |
| `services/gateway/src/repos/tasks.ts` | 创建 | 任务仓储（创建/流转/看板） |
| `services/gateway/src/repos/tasks.test.ts` | 创建 | 任务仓储测试 |
| `services/gateway/src/routes/tasks.ts` | 创建 | 任务路由（创建+卡片/流转/看板） |
| `services/gateway/src/routes/tasks.test.ts` | 创建 | 任务路由测试 |
| `services/gateway/src/server.ts` | 修改 | 注册任务路由 |
| `apps/web/src/api/client.ts` | 修改 | createTask/updateTaskStatus/listTasks |
| `apps/web/src/pages/Chat.tsx` | 修改 | 任务卡渲染 + 状态流转按钮 + message.updated 处理（复用） |
| `apps/web/src/pages/Chat.test.tsx` | 修改 | 任务卡用例 |
| `README.md` | 修改 | 任务卡说明 |

---

## Task 1: 迁移 + 任务仓储

**Files:**
- Create: `services/gateway/migrations/004_tasks.sql`
- Create: `services/gateway/src/repos/tasks.ts`
- Create: `services/gateway/src/repos/tasks.test.ts`

- [ ] **Step 1: 写 migrations/004_tasks.sql**

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assignee_id TEXT NOT NULL,
  assignee_kind TEXT NOT NULL CHECK (assignee_kind IN ('human', 'agent')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
  due_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks (session_id);
```

- [ ] **Step 2: 写 repos/tasks.ts**

```ts
import pg from 'pg'
import type { Task, TaskStatus } from '@ta/contracts'

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
  const assignee = task.assigneeKind === 'agent' ? `@${task.assigneeId.replace('agent-', '')}` : task.assigneeId
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
```

- [ ] **Step 3: 写 repos/tasks.test.ts**

```ts
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
```

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker exec ta-db pg_isready -U ta -d ta_dev
pnpm --filter @ta/gateway migrate
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: migrate 应用 004；typecheck exit 0；既有 97 用例不回归 + 新增 tasks 3 用例全 PASS（总 100）。

- [ ] **Step 5: 提交**

```bash
git add services/gateway
git commit -m "feat(task): 任务仓储 + 迁移 004 + 卡片内容"
```

---

## Task 2: 任务路由（创建=卡片 + 流转 + 看板）

**Files:**
- Create: `services/gateway/src/routes/tasks.ts`
- Create: `services/gateway/src/routes/tasks.test.ts`
- Modify: `services/gateway/src/server.ts`

- [ ] **Step 1: 写 routes/tasks.ts**

```ts
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
      if (!title || title.length > 200) {
        return reply.code(400).send({ error: 'title is required (<=200 chars)' })
      }
      if (!assigneeId) {
        return reply.code(400).send({ error: 'assigneeId is required' })
      }
      if (assigneeKind !== 'human' && assigneeKind !== 'agent') {
        return reply.code(400).send({ error: 'assigneeKind must be human|agent' })
      }
      const task = await createTask(pool, {
        sessionId,
        title,
        assigneeId,
        assigneeKind,
        dueAt: request.body?.dueAt,
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
      const status = request.body?.status as TaskStatus | undefined
      if (!status || !STATUSES.includes(status)) {
        return reply.code(400).send({ error: 'status must be todo|in_progress|blocked|done' })
      }
      try {
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
```

- [ ] **Step 2: 修改 server.ts**

import 增 `registerTaskRoutes`；在 `registerApprovalRoutes(...)` 之后追加：

```ts
  registerTaskRoutes(
    app,
    config,
    pool,
    (message) => events.emit('message.created', message),
    (message) => events.emit('message.updated', message),
  )
```

- [ ] **Step 3: 写 routes/tasks.test.ts**

```ts
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
})
```

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；新增 tasks 路由 4 用例全 PASS；总用例 = 100 + 4 = 104。

- [ ] **Step 5: 提交**

```bash
git add services/gateway
git commit -m "feat(task): 任务路由（卡片消息 + 状态流转 + 看板列表）"
```

---

## Task 3: 前端任务卡

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/Chat.tsx`
- Modify: `apps/web/src/pages/Chat.test.tsx`

- [ ] **Step 1: client.ts 追加任务 API**

```ts
import type { Approval, Message, Session, Task, TaskStatus } from '@ta/contracts'
```

在 decideApproval 之后追加：

```ts
export const createTask = (
  sessionId: string,
  input: { title: string; assigneeId: string; assigneeKind: 'human' | 'agent'; dueAt?: string },
): Promise<{ task: Task; cardMessage: Message }> =>
  request(`/api/v1/sessions/${sessionId}/tasks`, { method: 'POST', body: JSON.stringify(input) })

export const updateTaskStatus = (taskId: string, status: TaskStatus): Promise<{ task: Task }> =>
  request(`/api/v1/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })

export const listTasks = (sessionId: string): Promise<{ tasks: Task[] }> =>
  request(`/api/v1/sessions/${sessionId}/tasks`)
```

- [ ] **Step 2: Chat.tsx 任务卡渲染 + 流转按钮**

1. import 增 `updateTaskStatus` 与 `Task` 类型（从 client/contracts）。

2. 消息渲染处（在 approval-card 分支旁）加任务卡分支——把渲染改为三态（confirmation_card / task_card / 普通 bubble）：

```tsx
            const isTask = m.contentType === 'task_card'
            ...
                {isCard ? (
                  <div className="approval-card">...</div>
                ) : isTask ? (
                  <div className="task-card">
                    <strong>{m.content}</strong>
                    {m.ref?.kind === 'task' && (
                      <div className="task-actions">
                        {['todo', 'in_progress', 'blocked', 'done'].map((s) => (
                          <button
                            key={s}
                            className={s === 'done' ? 'approve' : s === 'blocked' ? 'reject' : 'ghost'}
                            onClick={() => void moveTask(m, s as TaskStatus)}
                          >
                            {s === 'todo' ? '待开始' : s === 'in_progress' ? '进行中' : s === 'blocked' ? '阻塞' : '完成'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (...bubble...)}
```

3. moveTask 函数：

```tsx
  async function moveTask(message: Message, status: TaskStatus) {
    if (!message.ref || message.ref.kind !== 'task') return
    setError(null)
    try {
      const { task } = await updateTaskStatus(message.ref.id, status)
      // 乐观更新卡片标题（含新状态前缀）；WS message.updated 会权威覆盖
      const label = { todo: '📋 待开始', in_progress: '🔄 进行中', blocked: '⛔ 已阻塞', done: '✅ 已完成' }[status]
      const title = message.content.replace(/^[^\u4e00-\u9fa5]+/, '') // 剥掉旧状态 emoji/前缀
      const assignee = task.assigneeKind === 'agent' ? `@${task.assigneeId.replace('agent-', '')}` : task.assigneeId
      setMessages((prev) => prev.map((mm) => (mm.id === message.id ? { ...mm, content: `${label}：${title}（负责人 ${assignee}）` } : mm)))
    } catch (err) {
      setError(err instanceof Error ? err.message : '任务更新失败')
    }
  }
```

> 注：乐观更新逻辑较繁——实现时以「调用 updateTaskStatus 成功 → 更新本地卡片内容 → WS message.updated 权威覆盖」为准；`moveTask` 的内部实现可简化（如直接由 WS 驱动、不乐观更新——但卡片更新失败时用户看不到即时反馈，保留乐观更新更好）。以可编译、测试通过为准。

- [ ] **Step 3: Chat.test.tsx 补任务卡用例**

```tsx
  it('renders a task card with status buttons', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': {
        messages: [{
          id: 'm1', clientMsgId: 'c1', sessionId: 's1', senderId: 'u-alice', senderKind: 'human',
          contentType: 'task_card', content: '📋 待开始：支付网关对接（负责人 Ta-Fullstack）', seq: 1, createdAt: '',
          ref: { kind: 'task', id: 't1' },
        }],
      },
      '/api/v1/tasks/t1/status': { task: { id: 't1', sessionId: 's1', title: '支付网关对接', assigneeId: 'agent-ta-fullstack', assigneeKind: 'agent', status: 'in_progress' } },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText(/支付网关对接/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /进行中/ }))
    await waitFor(() => expect(screen.getByText(/进行中：支付网关对接/)).toBeTruthy())
  })
```

- [ ] **Step 4: app.css 加任务卡样式**

```css
.task-card { padding: 12px 14px; border: 1px solid #e5e5ea; border-radius: 14px; background: #fff; display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
.task-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.task-actions button { padding: 4px 12px; border: 1px solid #d2d2d7; border-radius: 10px; background: #fff; cursor: pointer; font-size: 12px; }
.task-actions .approve { background: #34c759; color: #fff; border-color: #34c759; }
.task-actions .reject { background: #ff3b30; color: #fff; border-color: #ff3b30; }
```

- [ ] **Step 5: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose
pnpm --filter @ta/web build
```

Expected: typecheck exit 0；web 测试 14 用例全 PASS；build 产出 dist/。

- [ ] **Step 6: 提交**

```bash
git add apps/web
git commit -m "feat(web): 任务卡渲染与状态流转"
```

---

## Task 4: 收尾（README + 全仓验收 + 推送）

**Files:**
- Modify: `README.md`（根）

- [ ] **Step 1: README 追加「任务卡」节**

在「### 组织与治理」之后追加：

```markdown
### 任务卡（轻量看板）

```bash
# 创建任务（assignee 可为人类或智能体）→ 生成任务卡片消息
curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/tasks \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"支付网关对接","assigneeId":"agent-ta-fullstack","assigneeKind":"agent"}'

# 流转状态（todo / in_progress / blocked / done）→ 卡片实时更新
curl -s -X PATCH localhost:3001/api/v1/tasks/<taskId>/status \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"status":"in_progress"}'

# 看板列表
curl -s localhost:3001/api/v1/sessions/<sessionId>/tasks -H "authorization: Bearer $TOKEN"
```
```

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm build
pnpm test
pnpm install --frozen-lockfile
```

Expected: build 全过；test 全绿（contracts 2 + gateway 104 + web 14 = 120）；frozen-lockfile 通过；`git status` 干净（除 README）。

- [ ] **Step 3: 提交 + 推送**

```bash
git add README.md
git commit -m "docs: README 补任务卡说明"
git push
```

Expected: 推送成功。

---

## Self-Review 记录（写完后自查）

- **Spec 覆盖**：PRD BL-3（任务与开发交付线 MVP：任务卡消息）→ 全计划；FR-TASK-01（任务分配：@ 分配 → 看板任务，MVP 用 API/UI 手动创建，@ 自动解析 Phase 2）；TaskCard 契约与 Task 状态机 → 复用。
- **占位符扫描**：无 TBD；Task 3 的 moveTask 乐观更新注明可简化。
- **类型一致性**：`Task`/`TaskStatus` 在 contracts/repo/map/路由/前端一致；`taskCardContent` 在 repo/路由/测试一致；`updateTaskStatus` 在 client/路由/测试一致。
- **已知取舍**：无看板页（Phase 2 拖拽看板）；@ 分配自动解析（Phase 2）；任务无子任务/依赖；前端任务卡按钮对非负责人开放（MVP 无权限细分，Phase 2 按角色限制）。
