# Phase 3 · 计划 21：多租户隔离基础（M3.3 / FR-ORG-01 / FR-SEC-02）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地多租户隔离基础（M3.3/FR-ORG-01/FR-SEC-02，P0/BL-9）：租户生命周期（创建/停用）+ 数据隔离（users/sessions 绑定 tenant_id，应用层强制——跨租户互不可见 + 停用租户成员登录被拒）。验收：两租户互不可见对方任何数据（隔离性专项测试）。

**Architecture:** 迁移 014：`tenants` 表（id/name/status active|suspended/created_at）+ `users.tenant_id`（默认 'default' 租户）+ `sessions.tenant_id`（继承创建者租户）+ 索引。登录：`upsertUser` 无租户用户自动入 'default' 租户（首个租户种子）；`requireAuth` 校验租户状态（suspended → 403「租户已停用」）。会话创建：继承 `request.user.tenantId`。隔离：`canAccessSession` 前置租户匹配（会话租户 ≠ 用户租户 → false）；`listVisibleSessionIds` 加租户过滤；`upsertUser`/登录返回租户信息。管理端点（adminOnly）：`POST /api/v1/org/tenants` 创建租户、`POST /api/v1/org/tenants/:id/suspend` 停用（理由入 audit）。RLS 双保险（DB 级）记 Phase 3 后续计划（应用层先行，验收同语义）。

**Tech Stack:** 无新依赖。PG 迁移 + 仓储 + 中间件 + 路由。

**决策记录：** 租户模型用「用户级租户归属」（users.tenant_id）+「会话级归属」（sessions.tenant_id 继承创建者）；数据隔离应用层先行（canAccessSession/列表过滤/登录闸门），RLS 策略层记后续（PRD 双保险的第二层）；'default' 为种子租户（首个用户自动入，管理端点可建新租户）；停用 = 登录拒绝 + 数据保留（PRD 语义，数据不删）；跨租户写操作由 isMember/canAccessSession 统一拦截（会话租户绑定，非本租户成员身份无法通过成员校验）；租户间 id 不冲突（UUID 全局唯一）；审计含 tenant 上下文（detail 加 tenantId）；admin 跨租户管理用管理端点（数据仍按租户隔离，admin 权限是操作权限非数据越权——记录：admin 可建租户但不自动可见其他租户数据，治理例外记后续）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `packages/contracts/src/index.ts` | 修改 | Tenant/TenantStatus + Session.tenantId + OrgMember.tenantId |
| `services/gateway/migrations/014_tenant.sql` | 创建 | tenants 表 + users/sessions 加列 + 种子租户 |
| `services/gateway/src/repos/tenants.ts` | 创建 | 租户仓储（create/list/suspend/getUserTenant） |
| `services/gateway/src/repos/users.ts` | 修改 | upsertUser 入默认租户 + 返回 tenantId |
| `services/gateway/src/middleware.ts` | 修改 | requireAuth 校验租户状态 |
| `services/gateway/src/repos/access.ts` | 修改 | canAccessSession/listVisibleSessionIds 加租户匹配 |
| `services/gateway/src/repos/sessions.ts` | 修改 | 创建继承租户 + 查询带租户过滤 |
| `services/gateway/src/routes/org.ts` | 修改 | 租户创建/停用端点 |
| `services/gateway/src/routes/sessions.ts` | 修改 | 创建传租户（来自 user） |
| `services/gateway/src/routes/tenants.test.ts` | 创建 | 隔离性测试 |
| `services/gateway/src/repos/test-helpers.ts` | 修改 | truncate 增 tenants |
| `README.md` | 修改 | 多租户说明 |

---

## Task 1: 契约 + 迁移 014

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `services/gateway/migrations/014_tenant.sql`

- [ ] **Step 1: 契约**

读 `packages/contracts/src/index.ts`：
1. `Session` 接口增 `tenantId?: string`。
2. `OrgMember` 接口（读现状确认字段）增 `tenantId?: string`。
3. 文件末尾追加：

```ts
export const TenantStatus = {
  Active: 'active',
  Suspended: 'suspended',
} as const
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus]

export interface Tenant {
  id: string
  name: string
  status: TenantStatus
  createdAt: string
}
```

- [ ] **Step 2: 迁移 014**

创建 `services/gateway/migrations/014_tenant.sql`：

```sql
-- 多租户隔离（FR-ORG-01/FR-SEC-02）：租户生命周期 + 数据归属
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 种子租户：default（首个用户自动加入）
INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'default')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants (id) ON DELETE SET NULL;
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON sessions (tenant_id);
```

- [ ] **Step 3: 构建 + 迁移**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway migrate
```

Expected: 014 应用；tenants 表 + 种子 default 行 + 两列 + 索引。

- [ ] **Step 4: 提交**

```bash
git add packages/contracts services/gateway/migrations/014_tenant.sql
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(tenant): 契约 Tenant/tenantId + 迁移 014（租户表/归属列/种子）"
```

---

## Task 2: 租户仓储 + 登录/会话改造

**Files:**
- Create: `services/gateway/src/repos/tenants.ts`
- Modify: `services/gateway/src/repos/users.ts`
- Modify: `services/gateway/src/middleware.ts`
- Modify: `services/gateway/src/repos/sessions.ts`
- Modify: `services/gateway/src/routes/sessions.ts`

- [ ] **Step 1: 写 repos/tenants.ts**

创建 `services/gateway/src/repos/tenants.ts`：

```ts
import pg from 'pg'
import type { Tenant, TenantStatus } from '@ta/contracts'

export interface TenantRow {
  id: string
  name: string
  status: string
  created_at: Date
}

export function mapTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    status: row.status as TenantStatus,
    createdAt: row.created_at.toISOString(),
  }
}

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001'

export async function getDefaultTenant(pool: pg.Pool): Promise<string> {
  return DEFAULT_TENANT_ID
}

export async function getTenant(pool: pg.Pool, id: string): Promise<Tenant | null> {
  const res = await pool.query<TenantRow>('SELECT * FROM tenants WHERE id = $1', [id])
  return res.rows[0] ? mapTenant(res.rows[0]) : null
}

export async function listTenants(pool: pg.Pool): Promise<Tenant[]> {
  const res = await pool.query<TenantRow>('SELECT * FROM tenants ORDER BY created_at ASC')
  return res.rows.map(mapTenant)
}

export async function createTenant(pool: pg.Pool, name: string): Promise<Tenant> {
  const res = await pool.query<TenantRow>(
    `INSERT INTO tenants (name) VALUES ($1) RETURNING *`,
    [name],
  )
  return mapTenant(res.rows[0]!)
}

export async function suspendTenant(pool: pg.Pool, id: string): Promise<Tenant | null> {
  const res = await pool.query<TenantRow>(
    `UPDATE tenants SET status = 'suspended' WHERE id = $1 AND status = 'active' RETURNING *`,
    [id],
  )
  return res.rows[0] ? mapTenant(res.rows[0]) : null
}

/** 登录引导：无租户用户自动入 default 租户，返回 tenantId */
export async function ensureUserTenant(pool: pg.Pool, userId: string): Promise<string> {
  const res = await pool.query<{ tenant_id: string | null }>('SELECT tenant_id FROM users WHERE user_id = $1', [userId])
  if (res.rows[0]?.tenant_id) return res.rows[0].tenant_id
  await pool.query(`UPDATE users SET tenant_id = $2 WHERE user_id = $1 AND tenant_id IS NULL`, [userId, DEFAULT_TENANT_ID])
  return DEFAULT_TENANT_ID
}

/** 租户状态检查（停用 → 登录拒绝） */
export async function isTenantActive(pool: pg.Pool, tenantId: string): Promise<boolean> {
  const res = await pool.query<{ status: string }>('SELECT status FROM tenants WHERE id = $1', [tenantId])
  return res.rows[0]?.status === 'active'
}
```

- [ ] **Step 2: users.ts 登录返回租户**

读 `services/gateway/src/repos/users.ts`，`upsertUser` 后或 auth 路由登录后调用 `ensureUserTenant`。具体：
1. auth.ts 登录响应（读 `routes/auth.ts`）——`login` 里 upsertUser 后调 `await ensureUserTenant(pool, user.id)`，响应 `user` 增 `tenantId`；`requireAuth` 挂 `request.user.tenantId`。
2. `middleware.ts` 的 requireAuth：读用户时带 tenant_id，`request.user.tenantId`；并校验 `isTenantActive`（suspended → 403「租户已停用，请联系管理员」）。

**实现方式**（先读 auth.ts 与 middleware.ts 现状，最小改动）：
- `repos/users.ts` 的 `getUserRole`/相关查询 SELECT 增 `tenant_id`。
- auth 登录路由：upsertUser 后 `ensureUserTenant`，响应带 tenantId。
- middleware requireAuth：`request.user = { ...user, tenantId }`；`isTenantActive` 校验（停用 403）。

- [ ] **Step 3: sessions 创建继承租户**

读 `services/gateway/src/repos/sessions.ts` 与 `routes/sessions.ts`：
- `createSession` input 增 `tenantId`，INSERT 带 tenant_id。
- 路由创建：`tenantId: request.user.tenantId`（来自 middleware）。
- `mapSession` 输出 `tenantId`。

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
```

Expected: typecheck exit 0（若 OrgMember/Session 契约字段导致 map 报错，适配）。

- [ ] **Step 5: 提交**

```bash
git add services/gateway/src/repos/tenants.ts services/gateway/src/repos/users.ts services/gateway/src/middleware.ts services/gateway/src/repos/sessions.ts services/gateway/src/routes/sessions.ts services/gateway/src/routes/auth.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(tenant): 租户仓储 + 登录引导/闸门 + 会话继承租户"
```

---

## Task 3: 访问隔离 + 管理端点

**Files:**
- Modify: `services/gateway/src/repos/access.ts`
- Modify: `services/gateway/src/routes/org.ts`
- Modify: `services/gateway/src/repos/test-helpers.ts`

- [ ] **Step 1: access.ts 加租户匹配**

读 `services/gateway/src/repos/access.ts`：
1. `canAccessSession`：开头读用户 tenant_id 与会话 tenant_id，**不匹配直接 false**（前置租户隔离）：
```ts
  const userRes = await pool.query<{ role: string; department_id: string | null; tenant_id: string | null }>(
    'SELECT role, department_id, tenant_id FROM users WHERE user_id = $1', [userId])
  if (userRes.rows.length === 0) return false
  const u = userRes.rows[0]!
  const sessionRes = await pool.query<{ tenant_id: string | null }>('SELECT tenant_id FROM sessions WHERE id = $1', [sessionId])
  const s = sessionRes.rows[0]
  if (!s) return false
  if (u.tenant_id && s.tenant_id && u.tenant_id !== s.tenant_id) return false // 跨租户不可见
```
（现有 admin/成员/部门逻辑接续其后，租户匹配失败提前返回 false。）

2. `listVisibleSessionIds`：用户租户过滤——admin 分支只列本租户会话；成员/部门查询结果过滤会话租户 == 用户租户。实现：查询 `sessions WHERE tenant_id = $userTenant` 条件合并。

- [ ] **Step 2: org.ts 租户管理端点**

读 `services/gateway/src/routes/org.ts`（adminOnly 已存在），追加：

```ts
  app.post<{ Body: { name?: string } }>(
    '/api/v1/org/tenants',
    { preHandler: adminOnly },
    async (request, reply) => {
      const name = request.body?.name?.trim()
      if (!name || name.length > 100) return reply.code(400).send({ error: 'name is required (<=100 chars)' })
      try {
        const tenant = await createTenant(pool, name)
        void recordAudit(pool, {
          actorId: request.user!.id,
          action: 'tenant.created',
          target: tenant.id,
          detail: { name },
        }).catch((err) => console.error('[audit] tenant create failed:', err))
        return reply.code(201).send({ tenant })
      } catch (err) {
        return reply.code(409).send({ error: 'tenant name already exists' })
      }
    },
  )

  app.get('/api/v1/org/tenants', { preHandler: adminOnly }, async () => {
    return { tenants: await listTenants(pool) }
  })

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/v1/org/tenants/:id/suspend',
    { preHandler: adminOnly },
    async (request, reply) => {
      const id = request.params.id
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'tenant id must be a uuid' })
      }
      const tenant = await suspendTenant(pool, id)
      if (!tenant) return reply.code(409).send({ error: 'tenant not found or already suspended' })
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'tenant.suspended',
        target: id,
        detail: { reason: request.body?.reason?.trim() || null },
      }).catch((err) => console.error('[audit] tenant suspend failed:', err))
      return { tenant }
    },
  )
```

（import 增 createTenant/listTenants/suspendTenant。）

- [ ] **Step 3: test-helpers truncate 增 tenants**

读 `services/gateway/src/repos/test-helpers.ts`，truncate 清单增 `tenants`；**但种子 default 租户需重建**——truncate 后测试环境登录会 ensureUserTenant 指向不存在的 default 租户 id（FK SET NULL？）——**处理**：truncate tenants 后需重新 INSERT 种子行，或在 truncateAll 内保留 tenants 不 truncate（同 quota_config 先例——保留 tenants，测试共用 default 租户）。**采用保留策略**：truncateAll 不含 tenants（同 quota_config/approval_timeout 先例），种子租户常驻。

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；全量 gateway 测试全 PASS（既有用例用户/会话均在 default 租户，租户匹配恒真，行为不变）。

- [ ] **Step 5: 提交**

```bash
git add services/gateway/src/repos/access.ts services/gateway/src/routes/org.ts services/gateway/src/routes/org.test.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(tenant): 访问隔离（租户匹配）+ 租户管理端点"
```

---

## Task 4: 隔离性测试 + README + 验收 + 推送

**Files:**
- Create: `services/gateway/src/routes/tenants.test.ts`
- Modify: `README.md`

- [ ] **Step 1: tenants.test.ts（隔离性专项测试）**

创建 `services/gateway/src/routes/tenants.test.ts`（复用既有路由测试风格）：

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('tenant isolation', () => {
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

  it('isolates tenants: cross-tenant sessions are invisible', async () => {
    const admin = await loginAs('alice') // 首用户 admin，default 租户
    // 建第二租户
    const t2 = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/tenants',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: '租户B' },
    })
    const tenantB = t2.json().tenant.id as string
    // 把 bob 移入租户 B
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/org/users/u-u-bob/department`, // 无部门——改用租户分配（见注）
      headers: { authorization: `Bearer ${admin}` },
    }).catch(() => {})
    // 直接改 DB：bob 入租户 B
    await pool.query(`UPDATE users SET tenant_id = $1 WHERE user_id = 'u-bob'`, [tenantB])
    // alice（default 租户）建会话
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${admin}` },
      payload: { kind: 'project', title: 'A租户会话', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string
    // bob（租户 B）访问 A 租户会话 → 403（跨租户）
    const bob = await loginAs('bob')
    const denied = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${bob}` },
    })
    expect(denied.statusCode).toBe(403)
    // bob 会话列表不含 A 租户会话
    const list = await built.app.inject({
      method: 'GET',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${bob}` },
    })
    const titles = (list.json().sessions as Array<{ title: string }>).map((s) => s.title)
    expect(titles).not.toContain('A租户会话')
  })

  it('suspends a tenant and rejects its members login', async () => {
    const admin = await loginAs('alice')
    const t2 = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/tenants',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: '租户C' },
    })
    const tenantC = t2.json().tenant.id as string
    await pool.query(`UPDATE users SET tenant_id = $1 WHERE user_id = 'u-carol'`, [tenantC])
    // carol 登录正常（active）
    const ok = await loginAs('carol')
    expect(ok).toBeTruthy()
    // 停用租户 C
    const suspended = await built.app.inject({
      method: 'POST',
      url: `/api/v1/org/tenants/${tenantC}/suspend`,
      headers: { authorization: `Bearer ${admin}` },
      payload: { reason: '试用到期' },
    })
    expect(suspended.statusCode).toBe(200)
    expect(suspended.json().tenant.status).toBe('suspended')
    // carol 再登录 → 403（租户停用）
    const denied = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'carol' } })
    expect(denied.statusCode).toBe(403)
  })
})
```

> 注：租户分配端点本计划未定义（用户租户管理）——测试用直接 UPDATE users 模拟（隔离语义验证核心）。`u-bob`/`u-carol` 用户 id 用既有风格（先 loginAs 注册再 UPDATE）。若 `requireAuth` 的停用校验在登录时拦截（middleware 校验每次请求）——carol 停用后登录响应 403 的落点：登录路由 upsertUser 后若 tenant suspended 应拒绝——**需在 auth.ts 登录路由补 tenant active 校验**（ensureUserTenant 后查 isTenantActive，suspended → 403「租户已停用」），实现时在 Task 2/3 一并处理并在汇报说明。

- [ ] **Step 2: README 追加「多租户」节**

在 README「### 开放 API（M3.3 / FR-INT-02）」节之后追加：

```markdown
### 多租户隔离（M3.3 / FR-ORG-01 / FR-SEC-02）

租户是企业数据隔离单元（users/sessions 绑定 tenant_id，应用层强制）：跨租户会话互不可见（canAccessSession 租户匹配前置）；停用租户（`POST /api/v1/org/tenants/:id/suspend`，管理员，理由入审计）后其成员登录被拒、数据保留。租户管理：管理员 `POST /api/v1/org/tenants` 创建、`GET /api/v1/org/tenants` 列表。RLS 数据库级双保险记后续。
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

Expected: build 全过；test 全绿（contracts 2 + gateway 181+2≈183 + web 34 ≈ 219）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净。

- [ ] **Step 4: 真实验收（隔离性）**

```bash
cd /tmp
# 1) admin 登录 → 建租户 B → 直接改 DB 把 bob 移入 B
# 2) alice 建会话（含 bob）→ bob 访问详情 403 + 列表不可见
# 3) 建租户 C → carol 入 C → 登录 OK → 停用 C → carol 再登录 403
```

- [ ] **Step 5: 提交 + 推送**

```bash
git add README.md services/gateway/src/routes/tenants.test.ts docs/superpowers/plans/2026-08-15-phase3-plan3-tenant.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 21 全部勾选 + README 多租户说明"
git push
```

Expected: 推送成功（CI 应绿）。

---

## Self-Review 记录

- **Spec 覆盖**：FR-ORG-01（租户生命周期：创建/停用/状态）→ tenants 表 + 管理端点；FR-SEC-02（租户数据隔离：tenant_id 全局强制 + RLS 双保险）→ 应用层隔离（canAccessSession/列表/登录闸门），RLS 记后续；「停用 = 数据保留、访问关闭」→ suspend 不删数据 + 登录拒绝；「两租户互不可见任何数据」→ tenants.test.ts 隔离性专项。BL-9 治理闭环。
- **占位符扫描**：无 TBD；代码逐字给出（租户分配端点注已说明用 DB UPDATE 模拟）。
- **类型一致性**：`Tenant`（id/name/status/createdAt）+ `TenantStatus` 在契约/repo map/管理路由一致；`tenantId` 在 Session/OrgMember/request.user/canAccessSession 一致。
- **已知取舍**：应用层隔离先行（RLS 记后续计划）；用户租户分配端点（管理端转移用户租户）记后续（测试用 DB UPDATE）；admin 跨租户数据治理例外记后续；'default' 种子租户常驻（test-helpers 不 truncate tenants）；登录闸门落点需在 auth.ts 补（Task 2/3 注已列）。
