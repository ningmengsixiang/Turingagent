# Phase 1 · 计划 2：组织与权限 + 审计日志（M1.2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地企业治理地基（路线图 M1.2 / PRD Phase 1「组织基础 + RBAC + 审计日志」）：成员角色体系（admin/member）+ 管理路由（仅 admin）+ append-only 审计日志（角色变更、审批决策、登录留痕）。为后续审批人池、权限矩阵、组织 UI 铺路。

**Architecture:** `003_org.sql` 迁移（users 表 + audit_events 表）→ login 路由 upsert 用户（首次登录即注册为 member）→ `middleware.ts` 增 `requireRole('admin')` → `routes/org.ts`（GET 成员列表、PATCH 角色、GET 审计，均 admin-only）→ `repos/audit.ts`（append-only 审计写入）→ 关键操作埋点（审批决策、角色变更、登录）。契约补 `OrgMember` / `AuditEvent` 类型。

**Tech Stack:** 既有（Fastify + pg + vitest）；RBAC 最小化 = 两级角色（admin/member），PRD 权限矩阵的完整 RBAC/ABAC 后续计划（PRD FR-PERM-01 基础 + FR-PERM-03 审计）。

**决策记录：** 演示登录保留（`u-<name>`），首次登录 upsert 为 member；第一个注册用户自动为 admin（引导演示）；admin 才能管理成员/看审计；审计 append-only（仅 INSERT，无 UPDATE/DELETE 路径）；审计条目含 actor/action/target/detail。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/migrations/003_org.sql` | 创建 | users + audit_events 表 |
| `services/gateway/src/repos/users.ts` | 创建 | upsertUser / getUserRole / listMembers / setRole |
| `services/gateway/src/repos/users.test.ts` | 创建 | 用户仓储测试 |
| `services/gateway/src/repos/audit.ts` | 创建 | recordAudit（append-only）/ listAudit |
| `services/gateway/src/repos/audit.test.ts` | 创建 | 审计仓储测试 |
| `services/gateway/src/routes/org.ts` | 创建 | GET members / PATCH role / GET audit（admin-only） |
| `services/gateway/src/routes/org.test.ts` | 创建 | 组织路由测试 |
| `services/gateway/src/middleware.ts` | 修改 | 增 requireRole |
| `services/gateway/src/routes/auth.ts` | 修改 | 登录时 upsert 用户 + 审计留痕 |
| `services/gateway/src/routes/approvals.ts` | 修改 | 决策时审计留痕 |
| `services/gateway/src/server.ts` | 修改 | 注册 org 路由 |
| `packages/contracts/src/index.ts` | 修改 | OrgMember / AuditEvent 类型 |
| `README.md` | 修改 | 组织与治理冒烟说明 |

---

## Task 1: 迁移 + 契约 + 用户/审计仓储

**Files:**
- Create: `services/gateway/migrations/003_org.sql`
- Modify: `packages/contracts/src/index.ts`
- Create: `services/gateway/src/repos/users.ts`
- Create: `services/gateway/src/repos/audit.ts`
- Create: `services/gateway/src/repos/users.test.ts`
- Create: `services/gateway/src/repos/audit.test.ts`

- [ ] **Step 1: 写 migrations/003_org.sql**

```sql
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events (created_at DESC);
```

- [ ] **Step 2: 修改 contracts（末尾追加 OrgMember / AuditEvent）**

```ts
export interface OrgMember {
  userId: string
  name: string
  role: 'admin' | 'member'
  createdAt: string
}

export interface AuditEvent {
  id: string
  actorId: string
  action: string
  target?: string
  detail: Record<string, unknown>
  createdAt: string
}
```

- [ ] **Step 3: 写 repos/users.ts**

```ts
import pg from 'pg'
import type { OrgMember } from '@ta/contracts'

export type UserRole = 'admin' | 'member'

export interface UserRow {
  user_id: string
  name: string
  role: string
  created_at: Date
}

export function mapUser(row: UserRow): OrgMember {
  return {
    userId: row.user_id,
    name: row.name,
    role: row.role as UserRole,
    createdAt: row.created_at.toISOString(),
  }
}

/** 首次登录即注册（upsert）：全表为空时第一个用户自动成为 admin */
export async function upsertUser(pool: pg.Pool, userId: string, name: string): Promise<OrgMember> {
  await pool.query(
    `INSERT INTO users (user_id, name, role)
     VALUES ($1, $2, CASE WHEN NOT EXISTS (SELECT 1 FROM users) THEN 'admin' ELSE 'member' END)
     ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name`,
    [userId, name],
  )
  const res = await pool.query<UserRow>('SELECT * FROM users WHERE user_id = $1', [userId])
  return mapUser(res.rows[0]!)
}

export async function getUserRole(pool: pg.Pool, userId: string): Promise<UserRole | null> {
  const res = await pool.query<{ role: string }>('SELECT role FROM users WHERE user_id = $1', [userId])
  return res.rows[0] ? (res.rows[0].role as UserRole) : null
}

export async function listMembers(pool: pg.Pool): Promise<OrgMember[]> {
  const res = await pool.query<UserRow>('SELECT * FROM users ORDER BY created_at ASC')
  return res.rows.map(mapUser)
}

export async function setRole(
  pool: pg.Pool,
  userId: string,
  role: UserRole,
): Promise<OrgMember | null> {
  const res = await pool.query<UserRow>(
    `UPDATE users SET role = $2 WHERE user_id = $1 RETURNING *`,
    [userId, role],
  )
  return res.rows[0] ? mapUser(res.rows[0]) : null
}
```

- [ ] **Step 4: 写 repos/audit.ts（append-only）**

```ts
import pg from 'pg'
import type { AuditEvent } from '@ta/contracts'

export interface AuditRow {
  id: string
  actor_id: string
  action: string
  target: string | null
  detail: Record<string, unknown>
  created_at: Date
}

export function mapAudit(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    target: row.target ?? undefined,
    detail: row.detail,
    createdAt: row.created_at.toISOString(),
  }
}

/** append-only：审计只 INSERT，无 UPDATE/DELETE 路径 */
export async function recordAudit(
  pool: pg.Pool,
  input: { actorId: string; action: string; target?: string; detail?: Record<string, unknown> },
): Promise<AuditEvent> {
  const res = await pool.query<AuditRow>(
    `INSERT INTO audit_events (actor_id, action, target, detail)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.actorId, input.action, input.target ?? null, input.detail ?? {}],
  )
  return mapAudit(res.rows[0]!)
}

export async function listAudit(pool: pg.Pool, limit: number): Promise<AuditEvent[]> {
  const res = await pool.query<AuditRow>(
    'SELECT * FROM audit_events ORDER BY id DESC LIMIT $1',
    [Math.min(Math.max(1, limit), 200)],
  )
  return res.rows.map(mapAudit)
}
```

- [ ] **Step 5: 写 repos/users.test.ts**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from './test-helpers.js'
import { upsertUser, getUserRole, listMembers, setRole } from './users.js'

describe('user repository', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
  })

  it('makes the first user an admin and later users members', async () => {
    const first = await upsertUser(pool, 'u-alice', 'alice')
    expect(first.role).toBe('admin')
    const second = await upsertUser(pool, 'u-bob', 'bob')
    expect(second.role).toBe('member')
  })

  it('upserts keep role and update name', async () => {
    await upsertUser(pool, 'u-alice', 'alice')
    await upsertUser(pool, 'u-alice', 'alice2')
    const members = await listMembers(pool)
    expect(members).toHaveLength(1)
    expect(members[0]!.name).toBe('alice2')
    expect(members[0]!.role).toBe('admin')
  })

  it('sets and reads roles', async () => {
    await upsertUser(pool, 'u-bob', 'bob')
    expect(await getUserRole(pool, 'u-bob')).toBe('member')
    const updated = await setRole(pool, 'u-bob', 'admin')
    expect(updated?.role).toBe('admin')
    expect(await getUserRole(pool, 'u-bob')).toBe('admin')
    expect(await setRole(pool, 'u-ghost', 'admin')).toBeNull()
  })
})
```

- [ ] **Step 6: 写 repos/audit.test.ts**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from './test-helpers.js'
import { recordAudit, listAudit } from './audit.js'

describe('audit repository', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
  })

  it('records and lists audit events newest first', async () => {
    await recordAudit(pool, { actorId: 'u-alice', action: 'approval.decided', target: 'a1', detail: { status: 'approved' } })
    await recordAudit(pool, { actorId: 'u-alice', action: 'role.changed', target: 'u-bob', detail: { from: 'member', to: 'admin' } })
    const events = await listAudit(pool, 10)
    expect(events).toHaveLength(2)
    expect(events[0]!.action).toBe('role.changed') // 最新在前
    expect(events[0]!.target).toBe('u-bob')
    expect(events[0]!.detail).toEqual({ from: 'member', to: 'admin' })
  })

  it('respects the limit', async () => {
    for (let i = 0; i < 5; i++) {
      await recordAudit(pool, { actorId: 'u-alice', action: 'login' })
    }
    const events = await listAudit(pool, 2)
    expect(events).toHaveLength(2)
  })
})
```

- [ ] **Step 7: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker exec ta-db pg_isready -U ta -d ta_dev
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway migrate
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: migrate 应用 003；typecheck exit 0；既有 74 用例不回归 + 新增 users 3 + audit 2 = 5 用例全 PASS（总 79）。

- [ ] **Step 8: 提交**

```bash
git add packages/contracts services/gateway
git commit -m "feat(org): 用户/审计仓储 + 迁移 003 + 契约（OrgMember/AuditEvent）"
```

---

## Task 2: 组织路由（admin-only）+ 埋点

**Files:**
- Modify: `services/gateway/src/middleware.ts`
- Create: `services/gateway/src/routes/org.ts`
- Create: `services/gateway/src/routes/org.test.ts`
- Modify: `services/gateway/src/routes/auth.ts`（upsert + 审计）
- Modify: `services/gateway/src/routes/approvals.ts`（决策审计）
- Modify: `services/gateway/src/server.ts`（注册 org 路由）

- [ ] **Step 1: middleware.ts 增 requireRole**

在 `requireAuth` 之后追加：

```ts
export function requireRole(role: 'admin') {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireAuthCore(request, reply)
    if (reply.sent) return
    const user = request.user!
    if (user.role !== role) {
      await reply.code(403).send({ error: `requires role: ${role}` })
    }
  }
}
```

> 注意：`requireAuth` 当前把 `user` 设为 `JwtUser`（无 role 字段）。需要扩展：`requireAuth` 内 upsert 后把 role 挂到 `request.user`（`JwtUser` 增 `role?: 'admin' | 'member'`）——实现时把 `requireAuth` 改为注入 `pool` 并在鉴权时 `getUserRole` 填充 role；`requireRole` 复用同一逻辑。以类型正确、语义清楚为准（JwtUser 增 role 字段，requireAuth(pool, config) 签名调整，既有调用点同步）。

- [ ] **Step 2: 写 routes/org.ts**

```ts
import type { FastifyInstance } from 'fastify'
import { requireRole } from '../middleware.js'
import { listMembers, setRole, type UserRole } from '../repos/users.js'
import { listAudit, recordAudit } from '../repos/audit.js'
import type { Config } from '../config.js'
import pg from 'pg'

export function registerOrgRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const adminOnly = requireRole('admin', pool, config)

  app.get('/api/v1/org/members', { preHandler: adminOnly }, async () => {
    const members = await listMembers(pool)
    return { members }
  })

  app.patch<{ Params: { id: string }; Body: { role?: string } }>(
    '/api/v1/org/members/:id/role',
    { preHandler: adminOnly },
    async (request, reply) => {
      const role = request.body?.role
      if (role !== 'admin' && role !== 'member') {
        return reply.code(400).send({ error: 'role must be admin|member' })
      }
      const updated = await setRole(pool, request.params.id, role as UserRole)
      if (!updated) return reply.code(404).send({ error: 'member not found' })
      await recordAudit(pool, {
        actorId: request.user!.id,
        action: 'role.changed',
        target: updated.userId,
        detail: { role },
      })
      return { member: updated }
    },
  )

  app.get<{ Querystring: { limit?: string } }>(
    '/api/v1/org/audit',
    { preHandler: adminOnly },
    async (request) => {
      const limit = Number(request.query.limit ?? 50) || 50
      const events = await listAudit(pool, limit)
      return { events }
    },
  )
}
```

- [ ] **Step 3: auth.ts 登录时 upsert + 审计**

`registerAuth(app, config)` 签名改为 `registerAuth(app, config, pool)`；登录成功处：

```ts
    const user = { id: `u-${username}`, name: username }
    const token = await signToken(user, config)
    // 首次登录即注册（第一个用户自动 admin）
    const member = await upsertUser(pool, user.id, user.name)
    void recordAudit(pool, { actorId: user.id, action: 'login', detail: { name: user.name } }).catch(() => {})
    return { token, user, role: member.role }
```

- [ ] **Step 4: approvals.ts 决策审计**

decide 成功处（`return { approval }` 前）：

```ts
        void recordAudit(pool, {
          actorId: userId,
          action: 'approval.decided',
          target: approval.id,
          detail: { decision: approval.status, title: approval.title },
        }).catch(() => {})
```

（import 增 `recordAudit`。）

- [ ] **Step 5: server.ts 注册 org 路由**

import 增 `registerOrgRoutes`；`registerApprovalRoutes` 之后追加：

```ts
  registerOrgRoutes(app, config, pool)
```

- [ ] **Step 6: 写 routes/org.test.ts**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('org routes', () => {
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

  async function loginAs(username: string): Promise<{ token: string; role: string }> {
    const res = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username } })
    return res.json()
  }

  it('first user becomes admin and can list members', async () => {
    const alice = await loginAs('alice')
    expect(alice.role).toBe('admin')
    const res = await built.app.inject({
      method: 'GET',
      url: '/api/v1/org/members',
      headers: { authorization: `Bearer ${alice.token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().members).toHaveLength(1)
  })

  it('member cannot access admin routes', async () => {
    const alice = await loginAs('alice') // 第一个用户 → admin
    await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob' } }) // 注册为 member
    const bobRes = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob' } })
    const bobToken = bobRes.json().token as string
    expect(bobRes.json().role).toBe('member')
    const res = await built.app.inject({
      method: 'GET',
      url: '/api/v1/org/members',
      headers: { authorization: `Bearer ${bobToken}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('admin changes a member role and it is audited', async () => {
    const alice = await loginAs('alice')
    await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob' } })
    const res = await built.app.inject({
      method: 'PATCH',
      url: '/api/v1/org/members/u-bob/role',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { role: 'admin' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().member.role).toBe('admin')
    const audit = await built.app.inject({
      method: 'GET',
      url: '/api/v1/org/audit',
      headers: { authorization: `Bearer ${alice.token}` },
    })
    expect(audit.statusCode).toBe(200)
    const actions = audit.json().events.map((e: { action: string }) => e.action)
    expect(actions).toContain('role.changed')
  })
})
```

- [ ] **Step 7: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；新增 org 路由 3 用例全 PASS；既有用例不回归；总用例 = 79 + 3 = 82（登录响应新增 role 字段——既有 login 测试若断言完整对象需检查，通常只断言字段存在，不应破坏）。

- [ ] **Step 8: 提交**

```bash
git add services/gateway
git commit -m "feat(org): 组织路由（admin-only 成员/角色/审计）+ 登录/决策埋点"
```

---

## Task 3: 收尾（README + 全仓验收 + 推送）

**Files:**
- Modify: `README.md`（根）

- [ ] **Step 1: README 追加「组织与治理」节**

在「### 审批与确认卡片」之后追加：

```markdown
### 组织与治理

```bash
# 首个登录用户自动成为 admin；admin 可管理成员角色与查看审计
curl -s localhost:3001/api/v1/org/members -H "authorization: Bearer $TOKEN"
curl -s -X PATCH localhost:3001/api/v1/org/members/u-bob/role \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"role":"admin"}'
curl -s "localhost:3001/api/v1/org/audit?limit=20" -H "authorization: Bearer $TOKEN"
# → 登录/角色变更/审批决策全部留痕（append-only 审计）
```
```

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm build
pnpm test
pnpm install --frozen-lockfile
```

Expected: build 全过；test 全绿（contracts 2 + gateway 82 + web 12 = 96）；frozen-lockfile 通过；`git status` 干净（除 README）。

- [ ] **Step 3: 提交 + 推送**

```bash
git add README.md
git commit -m "docs: README 补组织与治理说明"
git push
```

Expected: 推送成功。

---

## Self-Review 记录（写完后自查）

- **Spec 覆盖**：路线图 M1.2（组织基础 + RBAC + 审计）→ Task 1/2；PRD FR-ORG-03（成员与角色）、FR-PERM-01（RBAC 基础）、FR-PERM-03（操作审计）→ 全计划；审计 append-only（PRD 不可篡改）→ 仓储设计。
- **占位符扫描**：无 TBD；middleware 的 requireRole 注明实现调整（JwtUser 增 role、requireAuth 注入 pool）。
- **类型一致性**：`OrgMember`/`AuditEvent` 在 contracts/repo/map/路由/测试一致；`UserRole` 在 users.ts/org.ts 一致；登录响应新增 `role` 字段在 auth.ts/org.test 一致。
- **已知取舍**：两级角色（admin/member），PRD 五级权限矩阵后续计划；部门/租户/ABAC 延后；前端组织 UI 延后（后端 API 先行）；审计 detail 用 JSONB（明文，无加密——PRD 加密审计属 FR-SEC 范畴延后）。

## 决策记录（T1 阻塞点）

1. **test-helpers.ts 的 truncateAll 必须扩展**：`TRUNCATE messages, session_members, sessions, users, audit_events RESTART IDENTITY CASCADE`——新增 users/audit_events 表后，既有清库语句漏掉它们导致用例间串扰（已实证）。
