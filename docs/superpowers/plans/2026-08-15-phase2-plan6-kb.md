# Phase 2 · 计划 17：企业知识库（FR-MEM-03，全文检索 MVP）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地企业知识库 MVP（FR-MEM-03/BL-8）：会话内文档入库（标题+正文）→ 关键词全文检索（ILIKE，数据不出域）→ 前端知识库面板（列表/创建/搜索）。pgvector 语义检索与智能体上下文注入记 Phase 2 后续（TechDesign T2：先做全文检索）。

**Architecture:** 迁移 011 `kb_documents` 表（id/session_id/title/content/created_by/created_at，session 级隔离）→ 契约 `KbDocument` → 仓储 `repos/kb.ts`（createKbDocument/listKbForSession/searchKb）→ 路由 `routes/kb.ts`（POST 创建 / GET 列表 / GET ?q= 检索，isMember 校验 + audit）→ 前端 Chat.tsx 右侧面板「知识库」区（列表 + 创建表单 + 搜索框）。数据不出域（仅 PG 存储，无外部调用）。

**Tech Stack:** 无新依赖。PG ILIKE 检索 + Fastify + React。

**决策记录：** 全文检索用 ILIKE '%q%'（MVP，pg_trgm 索引/PG 全文检索记 Phase 2 后续）；知识库按 session 隔离（企业级全局库记 Phase 3 多租户）；智能体上下文注入（静默策略 respond 时自动附命中文档）记 Phase 2 后续（本计划仅提供检索 API 供前端/后续注入）；文档上限 content 10,000 字符（与消息一致）；创建权限 = 会话成员（与文件一致）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `packages/contracts/src/index.ts` | 修改 | KbDocument 类型 |
| `services/gateway/migrations/011_kb.sql` | 创建 | kb_documents 表 |
| `services/gateway/src/repos/kb.ts` | 创建 | 知识库仓储 |
| `services/gateway/src/routes/kb.ts` | 创建 | 创建/列表/检索路由 |
| `services/gateway/src/routes/kb.test.ts` | 创建 | 路由测试 |
| `services/gateway/src/server.ts` | 修改 | 注册 kb 路由 |
| `apps/web/src/api/client.ts` | 修改 | createKbDocument/listKbDocuments/searchKbDocuments |
| `apps/web/src/pages/Chat.tsx` | 修改 | 知识库面板 |
| `apps/web/src/pages/Chat.test.tsx` | 修改 | 知识库用例 |
| `apps/web/src/app.css` | 修改 | 知识库样式 |
| `README.md` | 修改 | 知识库说明 |

---

## Task 1: 契约 + 迁移 011

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `services/gateway/migrations/011_kb.sql`

- [ ] **Step 1: 契约 KbDocument**

读 `packages/contracts/src/index.ts`，文件末尾（QuotaStatus 之后）追加：

```ts
export interface KbDocument {
  id: string
  sessionId: string
  title: string
  content: string
  createdBy: string
  createdAt: string
}
```

- [ ] **Step 2: 迁移 011**

创建 `services/gateway/migrations/011_kb.sql`：

```sql
-- 企业知识库（FR-MEM-03）：会话级文档，全文检索 MVP（ILIKE）
CREATE TABLE IF NOT EXISTS kb_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_session ON kb_documents (session_id);
```

- [ ] **Step 3: 构建 + 迁移**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway migrate
```

Expected: 全 exit 0；011 应用（幂等）。

- [ ] **Step 4: 提交**

```bash
git add packages/contracts services/gateway/migrations/011_kb.sql
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(kb): 契约 KbDocument + 迁移 011 kb_documents"
```

---

## Task 2: 仓储 + 路由

**Files:**
- Create: `services/gateway/src/repos/kb.ts`
- Create: `services/gateway/src/routes/kb.ts`
- Create: `services/gateway/src/routes/kb.test.ts`
- Modify: `services/gateway/src/server.ts`

- [ ] **Step 1: 写 repos/kb.ts**

创建 `services/gateway/src/repos/kb.ts`：

```ts
import pg from 'pg'
import type { KbDocument } from '@ta/contracts'

export interface KbRow {
  id: string
  session_id: string
  title: string
  content: string
  created_by: string
  created_at: Date
}

export function mapKb(row: KbRow): KbDocument {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    content: row.content,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  }
}

export async function createKbDocument(
  pool: pg.Pool,
  input: { sessionId: string; title: string; content: string; createdBy: string },
): Promise<KbDocument> {
  const res = await pool.query<KbRow>(
    `INSERT INTO kb_documents (session_id, title, content, created_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.sessionId, input.title, input.content, input.createdBy],
  )
  return mapKb(res.rows[0]!)
}

export async function listKbForSession(pool: pg.Pool, sessionId: string): Promise<KbDocument[]> {
  const res = await pool.query<KbRow>(
    'SELECT * FROM kb_documents WHERE session_id = $1 ORDER BY created_at DESC',
    [sessionId],
  )
  return res.rows.map(mapKb)
}

/** 关键词全文检索（ILIKE，MVP；pg_trgm/全文索引记 Phase 2 后续） */
export async function searchKb(pool: pg.Pool, sessionId: string, q: string): Promise<KbDocument[]> {
  const like = `%${q}%`
  const res = await pool.query<KbRow>(
    `SELECT * FROM kb_documents
      WHERE session_id = $1 AND (title ILIKE $2 OR content ILIKE $2)
      ORDER BY created_at DESC`,
    [sessionId, like],
  )
  return res.rows.map(mapKb)
}
```

- [ ] **Step 2: 写 routes/kb.ts**

创建 `services/gateway/src/routes/kb.ts`：

```ts
import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware.js'
import { isMember } from '../repos/sessions.js'
import { createKbDocument, listKbForSession, searchKb } from '../repos/kb.js'
import { recordAudit } from '../repos/audit.js'
import type { Config } from '../config.js'
import pg from 'pg'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CONTENT = 10_000

export function registerKbRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const auth = requireAuth(config, pool)

  app.post<{ Params: { id: string }; Body: { title?: string; content?: string } }>(
    '/api/v1/sessions/:id/kb',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      if (!UUID_PATTERN.test(sessionId)) {
        return reply.code(400).send({ error: 'session id must be a uuid' })
      }
      const title = request.body?.title?.trim()
      const content = request.body?.content?.trim()
      if (!title || title.length > 200) {
        return reply.code(400).send({ error: 'title is required (<=200 chars)' })
      }
      if (!content || content.length > MAX_CONTENT) {
        return reply.code(400).send({ error: `content is required (<=${MAX_CONTENT} chars)` })
      }
      if (!(await isMember(pool, sessionId, request.user!.id))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const doc = await createKbDocument(pool, {
        sessionId,
        title,
        content,
        createdBy: request.user!.id,
      })
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'kb.created',
        target: doc.id,
        detail: { title: doc.title },
      }).catch((err) => console.error('[audit] kb create failed:', err))
      return reply.code(201).send({ document: doc })
    },
  )

  app.get<{ Params: { id: string }; Querystring: { q?: string } }>(
    '/api/v1/sessions/:id/kb',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      if (!UUID_PATTERN.test(sessionId)) {
        return reply.code(400).send({ error: 'session id must be a uuid' })
      }
      if (!(await isMember(pool, sessionId, request.user!.id))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const q = request.query.q?.trim()
      const documents = q ? await searchKb(pool, sessionId, q) : await listKbForSession(pool, sessionId)
      return { documents }
    },
  )
}
```

- [ ] **Step 3: 写 kb.test.ts**

创建 `services/gateway/src/routes/kb.test.ts`（复用既有路由测试风格，先读 skills.test.ts 或 files.test.ts 的 setup）：

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('kb routes', () => {
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

  it('creates and lists kb documents', async () => {
    const login = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } })
    const token = login.json().token as string
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/kb`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '登录方案', content: '采用 JWT + 刷新令牌，令牌有效期 2 小时。' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().document.title).toBe('登录方案')

    const list = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/kb`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(list.json().documents).toHaveLength(1)
  })

  it('searches kb by keyword', async () => {
    const login = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } })
    const token = login.json().token as string
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/kb`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '登录方案', content: 'JWT 刷新令牌' },
    })
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/kb`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '部署方案', content: 'Docker Compose 一键部署' },
    })
    const hit = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/kb?q=${encodeURIComponent('JWT')}`,
      headers: { authorization: `Bearer ${token}` },
    })
    const docs = hit.json().documents as Array<{ title: string }>
    expect(docs).toHaveLength(1)
    expect(docs[0]!.title).toBe('登录方案')
  })

  it('rejects oversized content', async () => {
    const login = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } })
    const token = login.json().token as string
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/kb`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '超长', content: 'x'.repeat(10_001) },
    })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 4: server.ts 注册**

读 `services/gateway/src/server.ts`，在 `registerSkillRoutes(app, config, pool)` 之后增：

```ts
  registerKbRoutes(app, config, pool)
```

（import 增 `registerKbRoutes`。）

- [ ] **Step 5: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose src/routes/kb.test.ts
```

Expected: typecheck exit 0；kb.test.ts 3 用例全 PASS。

- [ ] **Step 6: 提交**

```bash
git add services/gateway/src/repos/kb.ts services/gateway/src/routes/kb.ts services/gateway/src/routes/kb.test.ts services/gateway/src/server.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(kb): 知识库仓储 + 路由（创建/列表/关键词检索）"
```

---

## Task 3: 前端知识库面板

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/Chat.tsx`
- Modify: `apps/web/src/pages/Chat.test.tsx`
- Modify: `apps/web/src/app.css`

- [ ] **Step 1: client.ts 增 API**

读 `apps/web/src/api/client.ts`，末尾追加：

```ts
export const createKbDocument = (sessionId: string, title: string, content: string): Promise<{ document: KbDocument }> =>
  request(`/api/v1/sessions/${sessionId}/kb`, { method: 'POST', body: JSON.stringify({ title, content }) })

export const listKbDocuments = (sessionId: string): Promise<{ documents: KbDocument[] }> =>
  request(`/api/v1/sessions/${sessionId}/kb`)

export const searchKbDocuments = (sessionId: string, q: string): Promise<{ documents: KbDocument[] }> =>
  request(`/api/v1/sessions/${sessionId}/kb?q=${encodeURIComponent(q)}`)
```

（import 增 `KbDocument`。）

- [ ] **Step 2: Chat.tsx 知识库面板**

读 `apps/web/src/pages/Chat.tsx` 右侧面板（技能包/配额区之后），增知识库区：

1. 状态增：`const [kbDocs, setKbDocs] = useState<KbDocument[]>([])`、`const [kbTitle, setKbTitle] = useState('')`、`const [kbContent, setKbContent] = useState('')`、`const [kbQuery, setKbQuery] = useState('')`。

2. 加载函数（loadMessages 或独立）：
```tsx
  const loadKb = useCallback(async (sessionId: string) => {
    try {
      const r = await listKbDocuments(sessionId)
      setKbDocs(r.documents)
    } catch {
      /* 忽略 */
    }
  }, [])
```
（在 activeId effect 内调 `void loadKb(activeId)`。）

3. 创建/搜索函数：
```tsx
  async function handleKbCreate() {
    if (!activeId || !kbTitle.trim() || !kbContent.trim()) {
      setError('知识库标题与内容不能为空')
      return
    }
    try {
      await createKbDocument(activeId, kbTitle.trim(), kbContent.trim())
      setKbTitle('')
      setKbContent('')
      await loadKb(activeId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存知识库失败')
    }
  }
  async function handleKbSearch() {
    if (!activeId) return
    try {
      const r = kbQuery.trim() ? await searchKbDocuments(activeId, kbQuery.trim()) : await listKbDocuments(activeId)
      setKbDocs(r.documents)
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败')
    }
  }
```

4. 渲染（技能包区之后）：
```tsx
            <div className="kb-panel">
              <strong>知识库</strong>
              <div className="kb-search">
                <input value={kbQuery} onChange={(e) => setKbQuery(e.target.value)} placeholder="搜索…" />
                <button className="ghost small" onClick={() => void handleKbSearch()}>搜索</button>
              </div>
              <div className="kb-create">
                <input value={kbTitle} onChange={(e) => setKbTitle(e.target.value)} placeholder="文档标题" />
                <textarea value={kbContent} onChange={(e) => setKbContent(e.target.value)} placeholder="文档内容（≤10000 字）" rows={3} />
                <button className="ghost small" onClick={() => void handleKbCreate()}>保存</button>
              </div>
              <div className="kb-list">
                {kbDocs.map((d) => (
                  <div key={d.id} className="kb-doc">
                    <div className="kb-doc-title">{d.title}</div>
                    <div className="kb-doc-snippet">{d.content.slice(0, 80)}…</div>
                  </div>
                ))}
                {kbDocs.length === 0 && <div className="kanban-empty">空</div>}
              </div>
            </div>
```

5. app.css 增样式（kb-panel/kb-search/kb-create/kb-doc/kb-doc-title/kb-doc-snippet）——在技能包样式后追加。

- [ ] **Step 3: Chat.test.tsx 补用例**

在现有用例后追加：

```tsx
  it('creates and searches kb documents', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': { messages: [] },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
      '/api/v1/sessions/s1/kb': { documents: [] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    // 创建
    await screen.findByText(/知识库/)
    fireEvent.change(screen.getByPlaceholderText(/文档标题/), { target: { value: '登录方案' } })
    fireEvent.change(screen.getByPlaceholderText(/文档内容/), { target: { value: 'JWT 令牌' } })
    fireEvent.click(screen.getByRole('button', { name: /保存/ }))
    // 创建后列表刷新应显示新文档（mockFetch 需在 POST 分支推入——若复杂，断言创建成功无报错即可）
    expect(await screen.findByText(/登录方案/)).toBeTruthy()
  })
```

（mockFetch 的 POST /kb 分支——先读现有 mockFetch 实现确认是否需加分支推入列表；若不加分支，创建后 loadKb 返回空导致断言失败——需在 mockFetch 加 kb POST 分支（仿 files/messages 模式）或简化断言。）

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose src/pages/Chat.test.tsx
pnpm --filter @ta/web build
```

Expected: 全 exit 0；Chat.test.tsx 21 用例全 PASS（20+1）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/api/client.ts apps/web/src/pages/Chat.tsx apps/web/src/pages/Chat.test.tsx apps/web/src/app.css
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(kb): 前端知识库面板（列表/创建/搜索）"
```

---

## Task 4: README + 全仓验收 + 推送 + 真实验收

- [ ] **Step 1: README 追加「企业知识库」节**

在 README「### 审批超时升级（FR-APP-06）」节之后追加：

```markdown
### 企业知识库（FR-MEM-03）

会话级知识库文档（标题+正文，≤10000 字），支持关键词全文检索（ILIKE，MVP；pgvector 语义检索记 Phase 2 后续）：`POST /sessions/:id/kb` 创建、`GET /sessions/:id/kb?q=` 检索。数据仅存 PG（不出域）。智能体上下文注入记后续。

```bash
curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/kb \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"登录方案","content":"JWT + 刷新令牌，2 小时有效期"}'
curl -s "localhost:3001/api/v1/sessions/<sessionId>/kb?q=JWT" -H "authorization: Bearer $TOKEN"
```
```

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
```

Expected: build 全过；test 全绿（contracts 2 + gateway 174+3≈177 + web 33+1≈34 ≈ 213）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净（除 README/计划文档）。

- [ ] **Step 3: 真实验收（知识库创建/检索）**

```bash
cd /tmp
# 1) 登录建会话 → POST /sessions/:id/kb 创建 2 文档
# 2) GET /sessions/:id/kb?q=JWT → 只命中含 JWT 的文档
# 3) GET /sessions/:id/kb → 全列表（2 文档）
# 4) 越权：非成员访问 → 403
```

Expected: 创建/检索/列表正确；非成员 403；数据不出域（仅 PG）。

- [ ] **Step 4: 提交 + 推送**

```bash
git add README.md docs/superpowers/plans/2026-08-15-phase2-plan6-kb.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 17 全部勾选 + README 知识库说明"
git push
```

Expected: 推送成功（CI 应绿）。

---

## Self-Review 记录

- **Spec 覆盖**：FR-MEM-03（接入企业文档/代码库作为上下文；数据不出域）→ 文档入库 + 检索（Task 2）+ 前端面板（Task 3）；「作为智能体上下文」的注入记 Phase 2 后续（本计划提供检索 API 基础）；「数据不出域」→ 仅 PG 存储。TechDesign T2（先全文检索后 pgvector）→ ILIKE MVP。
- **占位符扫描**：无 TBD；代码逐字给出。
- **类型一致性**：`KbDocument`（id/sessionId/title/content/createdBy/createdAt）在契约/repos map/routes/前端一致。
- **已知取舍**：ILIKE 全文检索（pg_trgm/全文索引/PG15 语义检索记后续）；session 级隔离（企业全局库记 Phase 3）；智能体上下文注入记后续；无分页（MVP 全量返回，分页记后续）。
