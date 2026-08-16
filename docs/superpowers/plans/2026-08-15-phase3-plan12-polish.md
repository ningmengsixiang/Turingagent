# Phase 3 · 计划 30：小补全（templateId 持久化 + 租户转移 404）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地两处记录的小补全：① templateId 持久化（sessions 表加 `template_id` 列，创建写入、查询返回——补计划 23「templateId 仅响应回带不持久化」记录项）；② 租户转移端点校验用户存在（0 行命中 → 404——补计划 22「转移端点不校验目标用户存在」记录项）。

**Architecture:** 迁移 016：`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS template_id TEXT`（模板 id 非 UUID——与 templates/ 文件 id 一致，不加 FK）。`repos/sessions.ts`：createSession input 增 `templateId`、INSERT 写入、SessionRow/mapSession 返回 `templateId?`。`routes/sessions.ts`：创建传 templateId。`routes/org.ts`：转移端点先查 `SELECT 1 FROM users WHERE user_id=$1`，不存在 → 404（对照 role 端点 AdminLockoutError 先例）。测试：sessions 创建带 templateId 后查询返回；转移不存在用户 404。

**Tech Stack:** 无新依赖。PG 迁移 + 仓储 + 路由小改。

**决策记录：** template_id 用 TEXT（模板 id 是文件名约定的 `[a-z0-9-]+`，非 UUID——不加 FK/校验约束，创建时已校验存在）；查询返回 templateId（listSessionsVisible/详情均返回——mapSession 统一）；前端后续可用（模板徽标展示）；转移 404 用「查用户存在 → 404」最小实现（无 0 行 UPDATE 检测——UPDATE 本身无 rowCount 语义，显式查更清晰）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/migrations/016_template_id.sql` | 创建 | sessions 加 template_id 列 |
| `services/gateway/src/repos/sessions.ts` | 修改 | createSession 写入 + mapSession 返回 |
| `services/gateway/src/routes/sessions.ts` | 修改 | 创建传 templateId |
| `services/gateway/src/routes/org.ts` | 修改 | 转移端点用户存在 404 |
| `services/gateway/src/routes/sessions.test.ts` | 修改 | 持久化测试 |
| `services/gateway/src/routes/tenants.test.ts` | 修改 | 转移 404 测试 |
| `README.md` | 修改 | 说明更新 |

---

## Task 1: templateId 持久化

**Files:**
- Create: `services/gateway/migrations/016_template_id.sql`
- Modify: `services/gateway/src/repos/sessions.ts`
- Modify: `services/gateway/src/routes/sessions.ts`

- [ ] **Step 1: 迁移 016**

创建 `services/gateway/migrations/016_template_id.sql`：

```sql
-- 项目模板持久化（计划 30）：sessions 记录创建时套用的模板 id
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS template_id TEXT;
```

- [ ] **Step 2: repos/sessions.ts**

读 `services/gateway/src/repos/sessions.ts`：
1. `SessionRow` 增 `template_id: string | null`。
2. `mapSession` 返回增 `templateId: row.template_id ?? undefined`。
3. `createSession` input 增 `templateId?: string`；INSERT 增列（`INSERT INTO sessions (kind, title, tenant_id, template_id) VALUES ($1,$2,$3,$4)`——读现状核对现有 INSERT 列）。

- [ ] **Step 3: routes/sessions.ts**

读 `services/gateway/src/routes/sessions.ts` 创建路由：`createSession` 调用传 `templateId`（从已校验的 template 变量取——`template?.id`）。

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway migrate
pnpm --filter @ta/gateway typecheck
```

Expected: 016 应用；typecheck exit 0。

- [ ] **Step 5: 提交**

```bash
git add services/gateway/migrations/016_template_id.sql services/gateway/src/repos/sessions.ts services/gateway/src/routes/sessions.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(template): templateId 持久化（迁移 016 + 创建写入 + 查询返回）"
```

---

## Task 2: 租户转移 404 + 测试

**Files:**
- Modify: `services/gateway/src/routes/org.ts`
- Modify: `services/gateway/src/routes/sessions.test.ts`
- Modify: `services/gateway/src/routes/tenants.test.ts`
- Modify: `README.md`

- [ ] **Step 1: org.ts 转移端点 404**

读 `services/gateway/src/routes/org.ts` 转移端点（~:200-215），在 `transferUserTenant` 前增用户存在校验：

```ts
      const userExists = await pool.query<{ user_id: string }>('SELECT user_id FROM users WHERE user_id = $1', [userId])
      if (userExists.rows.length === 0) {
        return reply.code(404).send({ error: 'user not found' })
      }
```

- [ ] **Step 2: 测试**

1. `tenants.test.ts` 追加：
```tsx
  it('returns 404 when transferring an unknown user', async () => {
    const admin = await loginAs('alice')
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/org/users/u-ghost/tenant',
      headers: { authorization: `Bearer ${admin}` },
      payload: { tenantId: null },
    })
    expect(res.statusCode).toBe(404)
  })
```

2. `sessions.test.ts`（或 templates.test.ts）追加持久化断言：
```tsx
  it('persists templateId on session', async () => {
    const admin = await loginAs('alice')
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${admin}` },
      payload: { kind: 'project', title: '模板持久化', memberIds: ['u-bob'], templateId: 'software-delivery' },
    })
    const sessionId = created.json().session.id as string
    // 详情/列表查询返回 templateId
    const detail = await built.app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}`, headers: { authorization: `Bearer ${admin}` } })
    expect(detail.json().session.templateId).toBe('software-delivery')
    const list = await built.app.inject({ method: 'GET', url: '/api/v1/sessions', headers: { authorization: `Bearer ${admin}` } })
    const found = (list.json().sessions as Array<{ id: string; templateId?: string }>).find((s) => s.id === sessionId)
    expect(found?.templateId).toBe('software-delivery')
  })
```

（核对 sessions 详情端点存在——routes/sessions.ts 有 GET /sessions/:id ✓；用户 id 风格 u-bob。）

- [ ] **Step 3: README 更新**

读 README「### 行业项目模板（M3.1 / FR-ORG-05）」节，追加一句：

```markdown
模板套用会持久化到会话（`templateId` 字段，查询返回）。
```

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose src/routes/tenants.test.ts src/routes/templates.test.ts
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；新增用例 PASS；全量 211 用例（209+2）全 PASS。

- [ ] **Step 5: 提交**

```bash
git add services/gateway/src/routes/org.ts services/gateway/src/routes/tenants.test.ts services/gateway/src/routes/sessions.test.ts services/gateway/src/routes/templates.test.ts README.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(ops): 租户转移 404 + templateId 持久化测试"
```

---

## Task 3: 全仓验收 + 推送

- [ ] **Step 1: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
```

Expected: build 全过；test 全绿（contracts 2 + gateway 211 + web 34 ≈ 247）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净。

- [ ] **Step 2: 提交 + 推送**

```bash
git add docs/superpowers/plans/2026-08-15-phase3-plan12-polish.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 30 全部勾选"
git push
```

Expected: 推送成功（CI 应绿）。

---

## Self-Review 记录

- **Spec 覆盖**：补计划 23 记录项（templateId 不持久化）→ 迁移 + 写入 + 返回；补计划 22 记录项（转移不校验用户存在）→ 404。
- **占位符扫描**：无 TBD；代码逐字给出。
- **类型一致性**：templateId 在契约 Session（已有）/SessionRow/mapSession/createSession/路由/测试一致；404 语义在 org 端点/测试一致。
- **已知取舍**：template_id TEXT 无 FK（模板文件 id 约定）；列表/详情均返回 templateId（前端后续消费）。
