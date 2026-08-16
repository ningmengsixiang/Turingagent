# Phase 3 · 计划 22：多租户管理补全（用户租户转移 + 存量回填）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全多租户管理（M3.3/FR-ORG-01）：用户租户转移端点（管理员把用户移入/移出租户）+ 存量会话租户回填（迁移 015：NULL 租户会话回填为创建者租户或 default）+ 会话创建校验（跨租户成员加入拒绝）。隔离完整性：回填后无 NULL 租户会话，跨租户成员加入被拒（堵计划 21 记录的「存量 NULL 会话跨租户可见」与「跨租户可加成员」缺口）。

**Architecture:** 迁移 015：回填 SQL（`UPDATE sessions s SET tenant_id = u.tenant_id FROM users u WHERE s.tenant_id IS NULL AND u.user_id = s.created_by`——sessions 表需有 created_by？核对；无则回填 default 租户）→ `repos/tenants.ts` 增 `transferUserTenant(pool, userId, tenantId|null)`（管理员转移；置 NULL = 移出租户，登录时 ensureUserTenant 回 default）→ 路由 `POST /api/v1/org/users/:id/tenant`（adminOnly：转移用户租户 + audit `org.user_tenant`）→ `routes/sessions.ts` 创建会话时**校验成员租户**（memberIds 中已有租户的用户若与创建者租户不同 → 400「跨租户成员不可加入」；无租户用户允许加入）。测试：转移端点 + 回填 + 跨租户成员拒绝。

**Tech Stack:** 无新依赖。PG 迁移回填 + 仓储 + 路由。

**决策记录：** 回填策略：sessions 无 created_by 列（核对——若有则回填创建者租户，无则 default）；转移用户租户后其存量会话**不自动迁移**（会话归属不变，用户可见性随租户匹配变化——被移出租户的用户失去旧租户会话访问，记后续「会话整体迁移」）；跨租户成员加入拒绝在创建时校验（补计划 21 记录缺口）；RLS 双保险记后续（需连接上下文重构，独立工程）；转移端点 adminOnly + 审计；无租户用户转移 = 置 NULL（登录时自动回 default）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/migrations/015_tenant_backfill.sql` | 创建 | 存量会话租户回填 |
| `services/gateway/src/repos/tenants.ts` | 修改 | transferUserTenant |
| `services/gateway/src/routes/org.ts` | 修改 | POST /org/users/:id/tenant 转移端点 |
| `services/gateway/src/routes/sessions.ts` | 修改 | 创建时跨租户成员校验 |
| `services/gateway/src/routes/tenants.test.ts` | 修改 | 转移/回填/成员拒绝用例 |
| `README.md` | 修改 | 多租户补全说明 |

---

## Task 1: 回填迁移 + 转移仓储

**Files:**
- Create: `services/gateway/migrations/015_tenant_backfill.sql`
- Modify: `services/gateway/src/repos/tenants.ts`

- [ ] **Step 1: 读 sessions 表结构确认 created_by**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker exec ta-db psql -U ta -d ta_dev -c "\d sessions" | head -20
```

确认 sessions 有无 created_by 列（决定回填策略）。

- [ ] **Step 2: 迁移 015**

创建 `services/gateway/migrations/015_tenant_backfill.sql`（按 Step 1 结果选择）：
- 若有 created_by：
```sql
-- 存量会话租户回填：NULL 租户会话回填为创建者租户（创建者无租户则 default）
UPDATE sessions s
SET tenant_id = COALESCE(u.tenant_id, '00000000-0000-0000-0000-000000000001')
FROM users u
WHERE s.tenant_id IS NULL AND u.user_id = s.created_by;

UPDATE sessions SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
```
- 若无 created_by：
```sql
-- 存量会话租户回填：全部回填 default 租户（无 created_by 列）
UPDATE sessions SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
```

- [ ] **Step 3: repos/tenants.ts 增 transferUserTenant**

读 `services/gateway/src/repos/tenants.ts`，末尾追加：

```ts
/** 管理员转移用户租户（null = 移出租户，登录时回 default） */
export async function transferUserTenant(
  pool: pg.Pool,
  userId: string,
  tenantId: string | null,
): Promise<void> {
  await pool.query(`UPDATE users SET tenant_id = $2 WHERE user_id = $1`, [userId, tenantId])
}
```

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway migrate
```

Expected: 015 应用（回填幂等）；typecheck exit 0。

- [ ] **Step 5: 提交**

```bash
git add services/gateway/migrations/015_tenant_backfill.sql services/gateway/src/repos/tenants.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(tenant): 存量会话回填 + 用户租户转移仓储"
```

---

## Task 2: 转移端点 + 跨租户成员校验

**Files:**
- Modify: `services/gateway/src/routes/org.ts`
- Modify: `services/gateway/src/routes/sessions.ts`

- [ ] **Step 1: org.ts 转移端点**

读 `services/gateway/src/routes/org.ts`（adminOnly 已存在），追加：

```ts
  app.post<{ Params: { id: string }; Body: { tenantId?: string | null } }>(
    '/api/v1/org/users/:id/tenant',
    { preHandler: adminOnly },
    async (request, reply) => {
      const userId = request.params.id
      const tenantId = request.body?.tenantId ?? null
      if (tenantId !== null) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
          return reply.code(400).send({ error: 'tenantId must be a uuid or null' })
        }
        const tenant = await getTenant(pool, tenantId)
        if (!tenant) return reply.code(400).send({ error: 'tenant not found' })
      }
      await transferUserTenant(pool, userId, tenantId)
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'org.user_tenant',
        target: userId,
        detail: { tenantId },
      }).catch((err) => console.error('[audit] tenant transfer failed:', err))
      return { transferred: true, userId, tenantId }
    },
  )
```

（import 增 getTenant/transferUserTenant。）

- [ ] **Step 2: sessions.ts 创建时跨租户成员校验**

读 `services/gateway/src/routes/sessions.ts` 创建路由（memberIds 处理处），在 `createSession` 前增校验：

```ts
      // 跨租户成员校验（补计划 21 缺口）：已有租户的成员若与创建者租户不同 → 拒绝
      if (memberIds.length > 0 && request.user!.tenantId) {
        const members = await pool.query<{ user_id: string; tenant_id: string | null }>(
          `SELECT user_id, tenant_id FROM users WHERE user_id = ANY($1::text[])`,
          [memberIds],
        )
        for (const m of members.rows) {
          if (m.tenant_id && m.tenant_id !== request.user!.tenantId) {
            return reply.code(400).send({ error: `member ${m.user_id} is in a different tenant` })
          }
        }
      }
```

（成员 id 用既有风格 u-bob；无租户成员允许加入。）

- [ ] **Step 3: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；全量 gateway 测试全 PASS（192 用例——既有会话创建 memberIds 均为同租户 default，不受影响）。

- [ ] **Step 4: 提交**

```bash
git add services/gateway/src/routes/org.ts services/gateway/src/routes/sessions.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(tenant): 用户租户转移端点 + 创建会话跨租户成员校验"
```

---

## Task 3: 测试 + README + 验收 + 推送

**Files:**
- Modify: `services/gateway/src/routes/tenants.test.ts`
- Modify: `README.md`

- [ ] **Step 1: tenants.test.ts 补用例**

读 `services/gateway/src/routes/tenants.test.ts`，追加：

```ts
  it('transfers a user to another tenant (admin)', async () => {
    const admin = await loginAs('alice')
    const t2 = await built.app.inject({ method: 'POST', url: '/api/v1/org/tenants', headers: { authorization: `Bearer ${admin}` }, payload: { name: `租户T-${Date.now()}` } })
    const tenantT = t2.json().tenant.id as string
    const bob = await loginAs('bob')
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/users/u-bob/tenant',
      headers: { authorization: `Bearer ${admin}` },
      payload: { tenantId: tenantT },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().tenantId).toBe(tenantT)
    const row = await pool.query<{ tenant_id: string | null }>('SELECT tenant_id FROM users WHERE user_id = $1', ['u-bob'])
    expect(row.rows[0]!.tenant_id).toBe(tenantT)
  })

  it('rejects cross-tenant member on session create', async () => {
    const admin = await loginAs('alice')
    const t2 = await built.app.inject({ method: 'POST', url: '/api/v1/org/tenants', headers: { authorization: `Bearer ${admin}` }, payload: { name: `租户X-${Date.now()}` } })
    const tenantX = t2.json().tenant.id as string
    const bob = await loginAs('bob')
    await pool.query(`UPDATE users SET tenant_id = $1 WHERE user_id = 'u-bob'`, [tenantX])
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${admin}` },
      payload: { kind: 'project', title: '跨租户成员测试', memberIds: ['u-bob'] },
    })
    expect(session.statusCode).toBe(400)
    expect(session.json().error).toContain('different tenant')
  })

  it('backfills null-tenant sessions on migration', async () => {
    // 模拟存量 NULL 租户会话 → 回填后为 default 租户
    const admin = await loginAs('alice')
    const session = await built.app.inject({ method: 'POST', url: '/api/v1/sessions', headers: { authorization: `Bearer ${admin}` }, payload: { kind: 'project', title: '回填测试', memberIds: [] } })
    const sessionId = session.json().session.id as string
    await pool.query(`UPDATE sessions SET tenant_id = NULL WHERE id = $1`, [sessionId])
    // 迁移已在 beforeEach 的 buildApp 时运行？——回填迁移是一次性的（schema_migrations 已记账，不再跑）。
    // 验证方式：直接断言当前迁移状态——若本测试环境迁移已应用（015 在 schema_migrations），NULL 会话是测试内手动造的，
    // 回填不会自动再跑。改为验证「回填 SQL 幂等可手动执行」：手动跑回填 UPDATE 后断言 tenant_id 非 NULL。
    await pool.query(
      `UPDATE sessions SET tenant_id = COALESCE((SELECT u.tenant_id FROM users u WHERE u.user_id = sessions.created_by), '00000000-0000-0000-0000-000000000001') WHERE tenant_id IS NULL`,
    )
    const row = await pool.query<{ tenant_id: string | null }>('SELECT tenant_id FROM sessions WHERE id = $1', [sessionId])
    expect(row.rows[0]!.tenant_id).not.toBeNull()
  })
```

（第三用例需 sessions 有 created_by——Step 1 已核对；若无 created_by，回填 SQL 用 default 版并在测试中同步。）

- [ ] **Step 2: README 追加说明**

在 README「### 多租户隔离（M3.3 / FR-ORG-01 / FR-SEC-02）」节末尾追加：

```markdown
多租户管理补全：管理员 `POST /api/v1/org/users/:id/tenant` 转移用户租户（null 移出，登录回 default，审计留痕）；创建会话时跨租户成员加入被拒（400）；存量 NULL 租户会话由迁移 015 回填（创建者租户或 default）。RLS 数据库级双保险记后续。
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

Expected: build 全过；test 全绿（contracts 2 + gateway 192+3≈195 + web 34 ≈ 231）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净。

- [ ] **Step 4: 真实验收**

```bash
cd /tmp
# 1) admin 登录 → 建租户 → 转移 bob 入租户 → 查 users.tenant_id 确认
# 2) bob 转移后 alice 建会话含 bob → 400 跨租户成员
# 3) 手动造 NULL 租户会话 → 跑回填 SQL → tenant_id 非 NULL
```

- [ ] **Step 5: 提交 + 推送**

```bash
git add README.md services/gateway/src/routes/tenants.test.ts docs/superpowers/plans/2026-08-15-phase3-plan4-tenant-admin.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 22 全部勾选 + README 多租户补全说明"
git push
```

Expected: 推送成功（CI 应绿）。

---

## Self-Review 记录

- **Spec 覆盖**：FR-ORG-01（租户生命周期完整：创建/停用/转移）→ 转移端点；「数据完全隔离」缺口补全（存量 NULL 回填 + 跨租户成员拒绝）；审计（org.user_tenant）。RLS 记后续。
- **占位符扫描**：无 TBD；代码逐字给出（回填 SQL 按 created_by 列存在性二选一）。
- **类型一致性**：transferUserTenant 签名在 repos/路由/测试一致；tenantId `string | null` 在端点 body/audit/测试一致。
- **已知取舍**：转移用户后存量会话不自动迁移（会话归属不变）；RLS 双保险记后续（连接上下文重构）；无租户用户转移 = NULL（登录回 default）。
