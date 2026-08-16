# Phase 1 · 计划 5：记忆文档（BL-8）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 BL-8（记忆知识线）的 MVP：会话讨论可沉淀为**记忆文档**，支持**版本留痕**（编辑生成新版本，历史可查）——对应 FR-MEM-01（记忆自动沉淀，MVP 手动+智能体触发）/ FR-MEM-02（编辑留痕/版本）。

**Architecture:** `005_memories.sql` 迁移（memories 表 + memory_versions 表）→ `repos/memories.ts`（创建/读取/更新版本/列表）→ `routes/memories.ts`（GET /sessions/:id/memories、POST /sessions/:id/memories 创建、PUT /memories/:id 编辑生成新版本、GET /memories/:id/versions 历史）→ 智能体桥接联动（`@Ta-PM 沉淀需求基线` 时把回复写入记忆？MVP：手动创建 + 编辑版本；自动沉淀 Phase 2 用 LLM 摘要）。前端：会话上下文面板加「记忆」入口（渲染记忆列表 + 编辑）。契约补 `Memory` / `MemoryVersion`。

**Tech Stack:** 既有（Fastify + pg + vitest + React）；版本留痕 = append-only 版本表（每编辑插入新版本行，主表只存最新内容指针）。

**决策记录：** 记忆绑定会话（session_id FK）；每次编辑插入新版本（v1/v2/…，版本号递增）；`created_by` 记录作者；MVP 前端在聊天页侧栏加记忆列表 + 编辑弹层（完整上下文面板 Phase 1 后期）；自动沉淀（LLM 摘要讨论）Phase 2。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/migrations/005_memories.sql` | 创建 | memories + memory_versions 表 |
| `services/gateway/src/repos/memories.ts` | 创建 | 记忆仓储（版本递增） |
| `services/gateway/src/repos/memories.test.ts` | 创建 | 记忆仓储测试 |
| `services/gateway/src/routes/memories.ts` | 创建 | 记忆路由（CRUD + 版本） |
| `services/gateway/src/routes/memories.test.ts` | 创建 | 记忆路由测试 |
| `services/gateway/src/server.ts` | 修改 | 注册记忆路由 |
| `packages/contracts/src/index.ts` | 修改 | Memory/MemoryVersion 类型 |
| `apps/web/src/api/client.ts` | 修改 | 记忆 API |
| `apps/web/src/pages/Chat.tsx` | 修改 | 记忆列表 + 编辑弹层 |
| `apps/web/src/pages/Chat.test.tsx` | 修改 | 记忆用例 |
| `README.md` | 修改 | 记忆文档说明 |

---

## Task 1: 迁移 + 契约 + 记忆仓储

**Files:**
- Create: `services/gateway/migrations/005_memories.sql`
- Modify: `packages/contracts/src/index.ts`
- Create: `services/gateway/src/repos/memories.ts`
- Create: `services/gateway/src/repos/memories.test.ts`

- [ ] **Step 1: 写 migrations/005_memories.sql**

```sql
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  current_version INT NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memories_session ON memories (session_id);

CREATE TABLE IF NOT EXISTS memory_versions (
  id BIGSERIAL PRIMARY KEY,
  memory_id UUID NOT NULL REFERENCES memories (id) ON DELETE CASCADE,
  version INT NOT NULL,
  content TEXT NOT NULL,
  edited_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (memory_id, version)
);
```

- [ ] **Step 2: 修改 contracts（末尾追加）**

```ts
export interface Memory {
  id: string
  sessionId: string
  title: string
  content: string
  currentVersion: number
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface MemoryVersion {
  id: string
  memoryId: string
  version: number
  content: string
  editedBy: string
  createdAt: string
}
```

- [ ] **Step 3: 写 repos/memories.ts**

```ts
import pg from 'pg'
import type { Memory, MemoryVersion } from '@ta/contracts'

export interface MemoryRow {
  id: string
  session_id: string
  title: string
  content: string
  current_version: number
  created_by: string
  created_at: Date
  updated_at: Date
}

export interface MemoryVersionRow {
  id: string
  memory_id: string
  version: number
  content: string
  edited_by: string
  created_at: Date
}

export function mapMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    content: row.content,
    currentVersion: row.current_version,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export function mapMemoryVersion(row: MemoryVersionRow): MemoryVersion {
  return {
    id: row.id,
    memoryId: row.memory_id,
    version: row.version,
    content: row.content,
    editedBy: row.edited_by,
    createdAt: row.created_at.toISOString(),
  }
}

export async function createMemory(
  pool: pg.Pool,
  input: { sessionId: string; title: string; content: string; createdBy: string },
): Promise<Memory> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const res = await client.query<MemoryRow>(
      `INSERT INTO memories (session_id, title, content, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.sessionId, input.title, input.content, input.createdBy],
    )
    const memory = res.rows[0]!
    await client.query(
      'INSERT INTO memory_versions (memory_id, version, content, edited_by) VALUES ($1, 1, $2, $3)',
      [memory.id, input.content, input.createdBy],
    )
    await client.query('COMMIT')
    return mapMemory(memory)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getMemory(pool: pg.Pool, id: string): Promise<Memory | null> {
  const res = await pool.query<MemoryRow>('SELECT * FROM memories WHERE id = $1', [id])
  return res.rows[0] ? mapMemory(res.rows[0]) : null
}

export async function listMemoriesForSession(pool: pg.Pool, sessionId: string): Promise<Memory[]> {
  const res = await pool.query<MemoryRow>(
    'SELECT * FROM memories WHERE session_id = $1 ORDER BY updated_at DESC',
    [sessionId],
  )
  return res.rows.map(mapMemory)
}

export async function updateMemoryContent(
  pool: pg.Pool,
  input: { id: string; title?: string; content: string; editedBy: string },
): Promise<Memory> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const cur = await client.query<MemoryRow>('SELECT * FROM memories WHERE id = $1 FOR UPDATE', [input.id])
    if (!cur.rows[0]) throw new Error('memory not found')
    const nextVersion = cur.rows[0].current_version + 1
    const res = await client.query<MemoryRow>(
      `UPDATE memories
          SET title = COALESCE($2, title), content = $3, current_version = $4, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [input.id, input.title ?? null, input.content, nextVersion],
    )
    await client.query(
      'INSERT INTO memory_versions (memory_id, version, content, edited_by) VALUES ($1, $2, $3, $4)',
      [input.id, nextVersion, input.content, input.editedBy],
    )
    await client.query('COMMIT')
    return mapMemory(res.rows[0]!)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function listMemoryVersions(pool: pg.Pool, memoryId: string): Promise<MemoryVersion[]> {
  const res = await pool.query<MemoryVersionRow>(
    'SELECT * FROM memory_versions WHERE memory_id = $1 ORDER BY version ASC',
    [memoryId],
  )
  return res.rows.map(mapMemoryVersion)
}
```

- [ ] **Step 4: 写 repos/memories.test.ts**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from './test-helpers.js'
import { createSession } from './sessions.js'
import { createMemory, getMemory, listMemoriesForSession, updateMemoryContent, listMemoryVersions } from './memories.js'

describe('memory repository', () => {
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
    const session = await createSession(pool, { kind: 'project', title: '报销系统', memberIds: ['u-alice'] })
    sessionId = session.id
  })

  it('creates a memory with version 1', async () => {
    const memory = await createMemory(pool, {
      sessionId,
      title: '需求基线',
      content: '报销系统需求基线 v1',
      createdBy: 'u-alice',
    })
    expect(memory.currentVersion).toBe(1)
    expect(memory.title).toBe('需求基线')
    const versions = await listMemoryVersions(pool, memory.id)
    expect(versions).toHaveLength(1)
    expect(versions[0]!.version).toBe(1)
  })

  it('edits create new versions with history', async () => {
    const memory = await createMemory(pool, {
      sessionId,
      title: '需求基线',
      content: 'v1',
      createdBy: 'u-alice',
    })
    const v2 = await updateMemoryContent(pool, { id: memory.id, content: 'v2 内容', editedBy: 'u-bob' })
    expect(v2.currentVersion).toBe(2)
    expect(v2.content).toBe('v2 内容')
    const v3 = await updateMemoryContent(pool, { id: memory.id, content: 'v3 内容', editedBy: 'u-alice' })
    expect(v3.currentVersion).toBe(3)
    const versions = await listMemoryVersions(pool, memory.id)
    expect(versions).toHaveLength(3)
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3])
    expect(versions[2]!.editedBy).toBe('u-alice')
  })

  it('lists memories newest first', async () => {
    await createMemory(pool, { sessionId, title: '记忆一', content: 'a', createdBy: 'u-alice' })
    await createMemory(pool, { sessionId, title: '记忆二', content: 'b', createdBy: 'u-alice' })
    const memories = await listMemoriesForSession(pool, sessionId)
    expect(memories).toHaveLength(2)
    expect(memories[0]!.title).toBe('记忆二') // updated_at DESC
  })

  it('fails updating an unknown memory', async () => {
    await expect(
      updateMemoryContent(pool, { id: '00000000-0000-0000-0000-000000000000', content: 'x', editedBy: 'u-alice' }),
    ).rejects.toThrow(/memory not found/)
  })
})
```

- [ ] **Step 5: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker exec ta-db pg_isready -U ta -d ta_dev
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway migrate
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: migrate 应用 005；typecheck exit 0；既有 108 用例不回归 + 新增 memories 4 用例全 PASS（总 112）。

- [ ] **Step 6: 提交**

```bash
git add packages/contracts services/gateway
git commit -m "feat(memory): 记忆仓储（版本递增）+ 迁移 005 + 契约"
```

---

## Task 2: 记忆路由

**Files:**
- Create: `services/gateway/src/routes/memories.ts`
- Create: `services/gateway/src/routes/memories.test.ts`
- Modify: `services/gateway/src/server.ts`

- [ ] **Step 1: 写 routes/memories.ts**

```ts
import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware.js'
import { isMember } from '../repos/sessions.js'
import { createMemory, getMemory, listMemoriesForSession, updateMemoryContent, listMemoryVersions } from '../repos/memories.js'
import type { Config } from '../config.js'
import pg from 'pg'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerMemoryRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
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
      if (!(await isMember(pool, sessionId, userId))) {
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
      const updated = await updateMemoryContent(pool, { id: memoryId, title, content, editedBy: userId })
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
}
```

- [ ] **Step 2: 修改 server.ts**

import 增 `registerMemoryRoutes`；在 `registerTaskRoutes(...)` 之后追加：

```ts
  registerMemoryRoutes(app, config, pool)
```

- [ ] **Step 3: 写 routes/memories.test.ts**

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('memory routes', () => {
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

  it('creates and lists memories for a session', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/memories`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '需求基线', content: '报销系统需求基线 v1' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().memory.currentVersion).toBe(1)
    const list = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/memories`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(list.json().memories).toHaveLength(1)
  })

  it('edits create versions and history is queryable', async () => {
    const alice = await loginAs('alice')
    const bob = await loginAs('bob')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/memories`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '需求基线', content: 'v1' },
    })
    const memoryId = created.json().memory.id as string
    const edited = await built.app.inject({
      method: 'PUT',
      url: `/api/v1/memories/${memoryId}`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { content: 'v2 更新内容' },
    })
    expect(edited.statusCode).toBe(200)
    expect(edited.json().memory.currentVersion).toBe(2)
    const versions = await built.app.inject({
      method: 'GET',
      url: `/api/v1/memories/${memoryId}/versions`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(versions.json().versions).toHaveLength(2)
    expect(versions.json().versions[1]!.content).toBe('v2 更新内容')
  })

  it('denies non-members accessing memories', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const carol = await loginAs('carol')
    const res = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/memories`,
      headers: { authorization: `Bearer ${carol}` },
    })
    expect(res.statusCode).toBe(403)
  })
})
```

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；新增 memories 路由 3 用例全 PASS；总用例 = 112 + 3 = 115。

- [ ] **Step 5: 提交**

```bash
git add services/gateway
git commit -m "feat(memory): 记忆路由（创建/编辑版本/历史/列表）"
```

---

## Task 3: 前端记忆（列表 + 编辑）

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/Chat.tsx`
- Modify: `apps/web/src/pages/Chat.test.tsx`

- [ ] **Step 1: client.ts 追加记忆 API**

```ts
import type { Approval, Memory, MemoryVersion, Message, Session, Task, TaskStatus } from '@ta/contracts'
```

在 listTasks 之后追加：

```ts
export const listMemories = (sessionId: string): Promise<{ memories: Memory[] }> =>
  request(`/api/v1/sessions/${sessionId}/memories`)

export const createMemory = (
  sessionId: string,
  input: { title: string; content: string },
): Promise<{ memory: Memory }> =>
  request(`/api/v1/sessions/${sessionId}/memories`, { method: 'POST', body: JSON.stringify(input) })

export const updateMemory = (
  memoryId: string,
  input: { title?: string; content: string },
): Promise<{ memory: Memory }> => request(`/api/v1/memories/${memoryId}`, { method: 'PUT', body: JSON.stringify(input) })

export const listMemoryVersions = (memoryId: string): Promise<{ versions: MemoryVersion[] }> =>
  request(`/api/v1/memories/${memoryId}/versions`)
```

- [ ] **Step 2: Chat.tsx 记忆侧栏 + 编辑**

1. import 增 `listMemories, createMemory, updateMemory` 与 `Memory` 类型。
2. 组件状态增 `memories: Memory[]`；`activeId` 变化时加载 `listMemories`（与 loadMessages 并列）。
3. 侧边栏（session-sidebar）会话列表之下加「记忆」区块：

```tsx
        <div className="memory-block">
          <div className="memory-head">
            <strong>记忆</strong>
            <button className="ghost" onClick={() => void newMemory()}>＋</button>
          </div>
          {memories.map((mem) => (
            <div key={mem.id} className="memory-item">
              <button className="memory-title" onClick={() => setEditing(mem)}>{mem.title}</button>
            </div>
          ))}
        </div>
```

4. 编辑弹层（组件底部条件渲染）：

```tsx
      {editing && (
        <div className="memory-modal">
          <div className="memory-modal-box">
            <h3>{editing.id ? '编辑记忆' : '新建记忆'}</h3>
            <input value={memTitle} onChange={(e) => setMemTitle(e.target.value)} placeholder="标题" />
            <textarea value={memContent} onChange={(e) => setMemContent(e.target.value)} rows={6} placeholder="内容" />
            <div className="memory-modal-actions">
              <button className="ghost" onClick={() => setEditing(null)}>取消</button>
              <button onClick={() => void saveMemory()}>保存</button>
            </div>
          </div>
        </div>
      )}
```

5. 状态与函数：

```tsx
  const [memories, setMemories] = useState<Memory[]>([])
  const [editing, setEditing] = useState<Memory | null | 'new'>(null)
  const [memTitle, setMemTitle] = useState('')
  const [memContent, setMemContent] = useState('')

  async function newMemory() {
    setEditing('new')
    setMemTitle('')
    setMemContent('')
  }

  async function saveMemory() {
    if (!activeId) return
    try {
      if (editing === 'new') {
        await createMemory(activeId, { title: memTitle.trim(), content: memContent.trim() })
      } else if (editing) {
        await updateMemory(editing.id, { content: memContent.trim(), title: memTitle.trim() || undefined })
      }
      setEditing(null)
      const res = await listMemories(activeId)
      setMemories(res.memories)
    } catch (err) {
      setError(err instanceof Error ? err.message : '记忆保存失败')
    }
  }
```

（`editing` 打开时同步 memTitle/memContent：`onClick={() => { setEditing(mem); setMemTitle(mem.title); setMemContent(mem.content) }}`。）

- [ ] **Step 3: Chat.test.tsx 补记忆用例**

```tsx
  it('lists and creates memories', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': { messages: [] },
      '/api/v1/sessions/s1/memories': { memories: [{ id: 'mem1', sessionId: 's1', title: '需求基线', content: '基线内容', currentVersion: 1, createdBy: 'u-alice', createdAt: '', updatedAt: '' }] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText('需求基线')).toBeTruthy()
    expect(screen.getByText('记忆')).toBeTruthy()
  })
```

- [ ] **Step 4: app.css 加记忆样式**

```css
.memory-block { border-top: 1px solid #e5e5ea; padding-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.memory-head { display: flex; justify-content: space-between; align-items: center; }
.memory-head strong { font-size: 13px; color: #6e6e73; }
.memory-item .memory-title { width: 100%; text-align: left; border: none; background: none; cursor: pointer; padding: 6px 8px; border-radius: 8px; font-size: 13px; }
.memory-item .memory-title:hover { background: #f0f0f5; }
.memory-modal { position: fixed; inset: 0; background: rgba(0,0,0,.3); display: flex; align-items: center; justify-content: center; z-index: 10; }
.memory-modal-box { background: #fff; border-radius: 14px; padding: 20px; width: 480px; display: flex; flex-direction: column; gap: 10px; }
.memory-modal-box input, .memory-modal-box textarea { padding: 8px 10px; border: 1px solid #d2d2d7; border-radius: 8px; font-size: 14px; font-family: inherit; }
.memory-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
```

- [ ] **Step 5: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose
pnpm --filter @ta/web build
```

Expected: typecheck exit 0；web 测试 15 用例全 PASS；build 产出 dist/。

- [ ] **Step 6: 提交**

```bash
git add apps/web
git commit -m "feat(web): 记忆列表与编辑（版本留痕）"
```

---

## Task 4: 收尾（README + 全仓验收 + 推送）

**Files:**
- Modify: `README.md`（根）

- [ ] **Step 1: README 追加「记忆文档」节**

在「### 任务卡（轻量看板）」之后追加：

```markdown
### 记忆文档

```bash
# 创建记忆（会话内讨论的沉淀）→ 编辑自动生成新版本（留痕可查）
curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/memories \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"需求基线","content":"报销系统需求基线 v1"}'

curl -s -X PUT localhost:3001/api/v1/memories/<memoryId> \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"content":"v2 更新内容"}'

curl -s localhost:3001/api/v1/memories/<memoryId>/versions -H "authorization: Bearer $TOKEN"
# → 版本历史 [v1, v2, …]，append-only 留痕
```
```

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm build
pnpm test
pnpm install --frozen-lockfile
```

Expected: build 全过；test 全绿（contracts 2 + gateway 115 + web 15 = 132）；frozen-lockfile 通过；`git status` 干净（除 README）。

- [ ] **Step 3: 提交 + 推送**

```bash
git add README.md
git commit -m "docs: README 补记忆文档说明"
git push
```

Expected: 推送成功。

---

## Self-Review 记录（写完后自查）

- **Spec 覆盖**：BL-8（记忆知识线）→ 全计划；FR-MEM-01（记忆自动沉淀 MVP=手动+编辑）→ Task 1/2/3；FR-MEM-02（编辑留痕/版本）→ 版本表 + 路由；前端上下文面板的记忆入口（MVP 侧栏）→ Task 3。
- **占位符扫描**：无 TBD；Task 3 的 editing 状态机（'new' | Memory | null）注明。
- **类型一致性**：`Memory`/`MemoryVersion` 在 contracts/repo/map/路由/前端一致；`updateMemoryContent` 返回 Memory 在 repo/路由/测试一致。
- **已知取舍**：自动沉淀（LLM 摘要讨论）Phase 2；记忆不绑审批/任务（Phase 2 关联）；编辑权限=会话成员（无单独 author 权限）；版本表 append-only（无删除路径）。
