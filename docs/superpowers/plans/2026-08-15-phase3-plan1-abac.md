# Phase 3 · 计划 19：ABAC 数据行级权限（M3.2 / FR-PERM-02）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 ABAC 细粒度权限 MVP（M3.2/FR-PERM-02/BL-9）：部门属性 + 数据行级权限——项目会话归属部门，访问规则「管理员全可见 / 会话成员可见 / 同部门成员可见」，非本部门且非成员访问会话数据 → 403。会话列表按可见性过滤。

**Architecture:** 迁移 012：`departments` 表（id/name）+ `users.department_id`（nullable FK）+ `sessions.department_id`（nullable FK，项目归属部门）。仓储 `repos/access.ts`：`canAccessSession(pool, sessionId, userId)`（admin → true；会话成员 → true；会话有 department_id 且用户同部门 → true；否则 false）与 `listVisibleSessions`（admin 全部 + 成员 + 同部门项目）。`repos/sessions.ts` 的 `isMember` 保留（审批人/文件等成员语义不变）；**各路由的 isMember 校验分批替换为 canAccessSession**（先替换数据读取端点：消息列表/详情、记忆列表、任务列表、文件列表、知识库、审批详情；写操作保留 isMember 防越权写入）。会话列表路由改 `listVisibleSessions`。

**Tech Stack:** 无新依赖。PG 迁移 + 仓储 + Fastify 路由替换。

**决策记录：** ABAC MVP 用「部门属性 + 两级校验」最小模型（完整 ABAC 属性引擎/规则 DSL 记 Phase 3 后续）；`canAccessSession` 替换**读端点**的 isMember（写端点保留 isMember——写操作需成员身份，读操作放宽到同部门，符合「仅本部门成员可查看本部门项目」）；部门归属：会话创建时可带 departmentId（前端下拉记后续，MVP 用 API 参数），用户部门由管理员分配（`POST /api/v1/org/users/:id/department`，adminOnly）；管理员（role=admin）全可见（治理兜底）；会话列表可见性 = 成员 + 同部门项目 + admin 全部；无部门会话维持 isMember 语义。部门删除/重命名记后续。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `packages/contracts/src/index.ts` | 修改 | Department 类型 + Session.departmentId |
| `services/gateway/migrations/012_abac.sql` | 创建 | departments 表 + users/sessions 加列 |
| `services/gateway/src/repos/access.ts` | 创建 | canAccessSession/listVisibleSessions |
| `services/gateway/src/repos/sessions.ts` | 修改 | listSessions 改可见性过滤 |
| `services/gateway/src/routes/sessions.ts` | 修改 | 列表/详情/消息用 canAccessSession |
| `services/gateway/src/routes/org.ts` | 修改 | 用户部门分配端点（adminOnly） |
| `services/gateway/src/routes/messages.ts` | 修改 | 列表/创建校验换 canAccessSession（列表） |
| `services/gateway/src/routes/memories.ts` | 修改 | 列表校验换 canAccessSession |
| `services/gateway/src/routes/tasks.ts` | 修改 | 列表校验换 canAccessSession |
| `services/gateway/src/routes/files.ts` | 修改 | 列表/下载校验换 canAccessSession |
| `services/gateway/src/routes/kb.ts` | 修改 | 列表校验换 canAccessSession |
| `services/gateway/src/routes/approvals.ts` | 修改 | GET 详情校验换 canAccessSession |
| `services/gateway/src/routes/access.test.ts` | 创建 | 可见性测试 |
| `README.md` | 修改 | ABAC 说明 |

---

## Task 1: 契约 + 迁移 012

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `services/gateway/migrations/012_abac.sql`

- [ ] **Step 1: 契约**

读 `packages/contracts/src/index.ts`，`Session` 接口增（`unreadCount` 之后）：

```ts
  /** ABAC：归属部门（项目会话可见性属性） */
  departmentId?: string
```

文件末尾追加：

```ts
export interface Department {
  id: string
  name: string
  createdAt: string
}
```

- [ ] **Step 2: 迁移 012**

创建 `services/gateway/migrations/012_abac.sql`：

```sql
-- ABAC 行级权限（FR-PERM-02）：部门属性 + 会话可见性
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments (id) ON DELETE SET NULL;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_department ON users (department_id);
CREATE INDEX IF NOT EXISTS idx_sessions_department ON sessions (department_id);
```

- [ ] **Step 3: 构建 + 迁移**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway migrate
```

Expected: 012 应用（幂等）；departments 表 + 两列 + 索引存在。

- [ ] **Step 4: 提交**

```bash
git add packages/contracts services/gateway/migrations/012_abac.sql
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(abac): 契约 departmentId/Department + 迁移 012（部门表/属性列）"
```

---

## Task 2: access 仓储 + 可见性替换

**Files:**
- Create: `services/gateway/src/repos/access.ts`
- Modify: `services/gateway/src/repos/sessions.ts`

- [ ] **Step 1: 写 repos/access.ts**

创建 `services/gateway/src/repos/access.ts`：

```ts
import pg from 'pg'

export interface AccessUser {
  role: string
  department_id: string | null
}

export interface AccessSession {
  department_id: string | null
}

/** ABAC 行级访问：admin 全可见；会话成员可见；同部门项目会话可见 */
export async function canAccessSession(
  pool: pg.Pool,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const user = await pool.query<AccessUser>('SELECT role, department_id FROM users WHERE user_id = $1', [userId])
  if (user.rows.length === 0) return false
  if (user.rows[0]!.role === 'admin') return true

  // 会话成员（RBAC 成员语义）
  const member = await pool.query<{ session_id: string }>(
    'SELECT session_id FROM session_members WHERE session_id = $1 AND user_id = $2',
    [sessionId, userId],
  )
  if (member.rows.length > 0) return true

  // 同部门项目会话（ABAC 属性规则）
  const session = await pool.query<AccessSession>(
    'SELECT department_id FROM sessions WHERE id = $1',
    [sessionId],
  )
  const s = session.rows[0]
  if (!s) return false
  if (s.department_id && user.rows[0].department_id === s.department_id) return true
  return false
}

/** 可见会话 id 集（admin 全部 + 成员 + 同部门项目） */
export async function listVisibleSessionIds(pool: pg.Pool, userId: string): Promise<string[]> {
  const user = await pool.query<AccessUser>('SELECT role, department_id FROM users WHERE user_id = $1', [userId])
  if (user.rows.length === 0) return []
  if (user.rows[0]!.role === 'admin') {
    const all = await pool.query<{ id: string }>('SELECT id FROM sessions')
    return all.rows.map((r) => r.id)
  }
  const member = await pool.query<{ session_id: string }>(
    'SELECT session_id FROM session_members WHERE user_id = $1',
    [userId],
  )
  const ids = new Set(member.rows.map((r) => r.session_id))
  if (user.rows[0]!.department_id) {
    const dept = await pool.query<{ id: string }>(
      'SELECT id FROM sessions WHERE department_id = $1',
      [user.rows[0]!.department_id],
    )
    for (const r of dept.rows) ids.add(r.id)
  }
  return [...ids]
}
```

- [ ] **Step 2: sessions.ts 列表改可见性过滤**

读 `services/gateway/src/repos/sessions.ts`（先读 listSessions 现状），把 `listSessions` 改为接收 userId 并调用 `listVisibleSessionIds` 过滤：

```ts
// 现有 listSessions 查询保持不变，新增可见性过滤版本：
export async function listSessionsVisible(pool: pg.Pool, userId: string): Promise<Session[]> {
  const visible = await listVisibleSessionIds(pool, userId)
  if (visible.length === 0) return []
  const res = await pool.query<SessionRow>(
    `SELECT s.*, (SELECT count(*)::int FROM messages m WHERE m.session_id = s.id AND m.seq > COALESCE((SELECT last_read_seq FROM session_reads WHERE session_id = s.id AND user_id = $1), 0)) AS unread_count
     FROM sessions s WHERE s.id = ANY($2::uuid[]) ORDER BY s.created_at DESC`,
    [userId, visible],
  )
  return res.rows.map((r) => ({ ...mapSession(r), unreadCount: r.unread_count }))
}
```

（若现有 `listSessions` 被路由直接调用，改路由调 `listSessionsVisible`；原 listSessions 保留或替换——以路由现状为准，保持向后兼容。）

- [ ] **Step 3: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
```

Expected: typecheck exit 0（若 routes/sessions.ts 调 listSessions 报错——Task 3 处理路由替换，Task 2 允许中间态或同步最小改动）。

- [ ] **Step 4: 提交**

```bash
git add services/gateway/src/repos/access.ts services/gateway/src/repos/sessions.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(abac): access 仓储（canAccessSession/可见会话）+ 列表过滤"
```

---

## Task 3: 路由替换 + 部门分配端点

**Files:**
- Modify: `services/gateway/src/routes/sessions.ts`
- Modify: `services/gateway/src/routes/messages.ts`
- Modify: `services/gateway/src/routes/memories.ts`
- Modify: `services/gateway/src/routes/tasks.ts`
- Modify: `services/gateway/src/routes/files.ts`
- Modify: `services/gateway/src/routes/kb.ts`
- Modify: `services/gateway/src/routes/approvals.ts`
- Modify: `services/gateway/src/routes/org.ts`

- [ ] **Step 1: 逐个路由替换 isMember → canAccessSession（读端点）**

对每个文件，**读端点**的 `isMember(pool, sessionId, userId)` 校验替换为 `canAccessSession(pool, sessionId, userId)`（403 语义不变）；**写端点保留 isMember**。逐个：

1. `routes/sessions.ts`：GET /sessions（列表改调 listSessionsVisible）、GET /sessions/:id 详情（canAccessSession）。
2. `routes/messages.ts`：GET /sessions/:id/messages（canAccessSession）；POST 创建保留 isMember。
3. `routes/memories.ts`：GET /sessions/:id/memories（canAccessSession）；POST 保留 isMember。
4. `routes/tasks.ts`：GET /sessions/:id/tasks（canAccessSession）；POST/PATCH 保留 isMember。
5. `routes/files.ts`：GET /sessions/:id/files 与 GET /files/:id（canAccessSession，注意后者用 file.sessionId）；POST 上传保留 isMember。
6. `routes/kb.ts`：GET /sessions/:id/kb（canAccessSession）；POST 保留 isMember。
7. `routes/approvals.ts`：GET /api/v1/approvals/:id（canAccessSession）；decide/transfer/return/resubmit/cancel/escalate 保留 isMember（写/状态操作）。

**注意**：每个文件的 isMember import 保留（写端点仍用）；新增 canAccessSession import。逐个文件改完跑 typecheck。

- [ ] **Step 2: org.ts 部门分配端点**

读 `services/gateway/src/routes/org.ts`（确认 adminOnly 用法），追加：

```ts
  app.post<{ Params: { id: string }; Body: { departmentId?: string } }>(
    '/api/v1/org/users/:id/department',
    { preHandler: adminOnly },
    async (request, reply) => {
      const userId = request.params.id
      const departmentId = request.body?.departmentId?.trim()
      if (!departmentId) return reply.code(400).send({ error: 'departmentId is required' })
      const dept = await pool.query<{ id: string }>('SELECT id FROM departments WHERE id = $1', [departmentId])
      if (dept.rows.length === 0) return reply.code(400).send({ error: 'department not found' })
      await pool.query('UPDATE users SET department_id = $1 WHERE user_id = $2', [departmentId, userId])
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'org.user_department',
        target: userId,
        detail: { departmentId },
      }).catch((err) => console.error('[audit] department assign failed:', err))
      return { assigned: true }
    },
  )
```

（若 org.ts 无 adminOnly，用 `requireRoleFor(config, pool, 'admin')`——读现状。）

- [ ] **Step 3: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；全量 gateway 测试全 PASS（既有用例用 isMember 语义的写操作不受影响；读操作 403 用例若涉及部门场景需核对——既有测试多数用无部门会话，canAccessSession 对无部门会话 = isMember 语义（成员才可见），行为不变）。

- [ ] **Step 4: 提交**

```bash
git add services/gateway/src/routes
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(abac): 读端点替换 canAccessSession + 用户部门分配端点"
```

---

## Task 4: ABAC 测试 + README + 验收 + 推送

**Files:**
- Create: `services/gateway/src/routes/access.test.ts`
- Modify: `README.md`

- [ ] **Step 1: access.test.ts**

创建 `services/gateway/src/routes/access.test.ts`（复用既有路由测试风格）：

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('abac access', () => {
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

  it('hides department sessions from non-member outsiders but shows to same-department users', async () => {
    const admin = await loginAs('alice') // 首用户 admin
    // 建部门
    const dept = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/departments',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: '研发部' },
    })
    const departmentId = dept.json().department.id as string
    // alice（admin）与 bob 入部门
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/org/users/u-u-alice/department`,
      headers: { authorization: `Bearer ${admin}` },
      payload: { departmentId },
    })
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/org/users/u-u-bob/department`,
      headers: { authorization: `Bearer ${admin}` },
      payload: { departmentId },
    })
    // 建部门项目会话（alice 创建，含 bob）
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${admin}` },
      payload: { kind: 'project', title: '部门项目', memberIds: ['u-u-bob'], departmentId },
    })
    const sessionId = session.json().session.id as string
    // carol 非部门非成员 → 详情 403
    const carol = await loginAs('carol')
    const denied = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${carol}` },
    })
    expect(denied.statusCode).toBe(403)
    // bob 同部门成员 → 可见
    const bob = await loginAs('bob')
    const allowed = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${bob}` },
    })
    expect(allowed.statusCode).toBe(200)
  })
})
```

> 注：`POST /api/v1/org/departments` 端点本计划未定义——**需在 org.ts 补**（adminOnly 创建部门：`{ name }` → INSERT departments → `{ department }`，Task 3 一并加）。会话创建带 departmentId：routes/sessions.ts 的 POST 创建需接受 `departmentId` 并校验存在。这些是本测试的前置端点，实现时在 Task 3 补齐。

- [ ] **Step 2: README 追加「ABAC 权限」节**

在 README「### 私有化部署（M2.5）」节之后追加：

```markdown
### ABAC 数据行级权限（M3.2 / FR-PERM-02）

部门属性 + 数据行级可见性：项目会话可归属部门（`departmentId`），访问规则 = 管理员全可见 / 会话成员可见 / 同部门成员可见（读端点），写操作仍需会话成员身份。部门管理：管理员 `POST /api/v1/org/departments` 创建、`POST /api/v1/org/users/:id/department` 分配用户部门。会话列表按可见性过滤。完整属性规则引擎记后续。
```

- [ ] **Step 3: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
```

Expected: build 全过；test 全绿（contracts 2 + gateway 177+2≈179 + web 34 ≈ 215）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净。

- [ ] **Step 4: 真实验收（部门可见性）**

```bash
cd /tmp
# 1) admin 登录 → 建部门 → 分配 alice/bob 入部门
# 2) alice 建部门项目会话（含 bob）→ carol 访问详情 403、bob 访问 200
# 3) 会话列表：carol 看不到部门项目、bob 看得到
```

- [ ] **Step 5: 提交 + 推送**

```bash
git add README.md docs/superpowers/plans/2026-08-15-phase3-plan1-abac.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 19 全部勾选 + README ABAC 说明"
git push
```

Expected: 推送成功（CI 应绿）。

---

## Self-Review 记录

- **Spec 覆盖**：FR-PERM-02（属性级规则「仅本部门成员可查看本部门项目」，数据行级权限）→ departments 属性 + canAccessSession 行级校验 + 列表过滤（Task 2/3）；PR-3（越权 403 + 审计）→ 403 语义 + 部门分配审计。BL-9 治理闭环。
- **占位符扫描**：无 TBD；代码逐字给出。
- **类型一致性**：`Session.departmentId`（可选）在契约/repo 查询/路由创建参数一致；`Department`（id/name/createdAt）在契约/org 路由一致；`canAccessSession` 签名（pool/sessionId/userId）在各路由一致。
- **已知取舍**：ABAC MVP 仅部门单属性（完整属性引擎/规则 DSL 记后续）；写端点保留 isMember（防越权写入，读放宽同部门）；部门创建/分配端点随 Task 3/4 补（计划注已列）；部门删除/重命名/前端部门下拉记后续；admin 全可见（治理兜底）。
