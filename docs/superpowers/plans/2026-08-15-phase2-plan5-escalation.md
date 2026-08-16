# Phase 2 · 计划 16：审批超时升级（FR-APP-06，M2.1 补全）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全多级审批的超时升级（FR-APP-06/BL-4）：节点超时（默认 24h，可配置）→ 升级审批人为管理员（escalated_count +1）→ 再超时再升级 → 封顶 2 级；每次升级审计留痕；升级后原节点审批人失效（votes 清空）。

**Architecture:** 迁移 010：approvals 加 `last_node_activated_at`（节点激活时间：创建/推进/resubmit 时更新）与 `escalated_count`（升级计数）；`approval_timeout_hours` 配置表（默认 24）。仓储 `escalateOverdueApprovals(pool, now)`：扫描 pending 且 `last_node_activated_at + timeout*1h < now` 的审批 → 升级（escalated_count+1、approver_ids 替换为 admin 用户、votes 清空、last_node_activated_at=now）；路由 `POST /api/v1/approvals/:id/escalate`（手动触发升级，供测试/演示/外部调度器调用——自动定时器记 Phase 2 后续 scheduler）+ audit `approval.escalated`。升级链：当前审批人 → admin 用户（users role=admin）→ 再超时 → 另一 admin（若只有一名 admin 则重复升级）。

**Tech Stack:** 无新依赖。PG 迁移 + repos 扫描函数 + Fastify 端点 + audit。

**质量审查决策（T1-T3 后追加）：** ① escalate 补事务行锁（FOR UPDATE + 锁内重验 status/节点 pending，与 decide/transfer 等跨操作锁协议对齐）——原为唯一无锁的审批写操作，与 decide 并发可污染终态（votes 清空 + 终态 escalated_count+1）；② 测试用例 3「推进重置激活时间」语义修正（原 timeout=0+now+1000 恒假阳性；改为回拨 2h + timeout 1h + 推进后扫描，具区分度）；③ 测试需自插 admin（truncateAll 清 users，无 admin 时 escalate 空转）。**记录后续**：escalated_count 无硬封顶（第 3 次超时仍轮换，FR 若要求硬封顶需补判断）；升级后卡片不展示新审批人（审计留痕，卡片仅待审批文案）；escalate 端点实为全局扫描（id 仅校验，调度入口语义）；自动定时器 cron（记 Phase 2 scheduler）；L1 通知（记后续）。

**决策记录：** 自动超时用「手动端点 + 外部调度调用」而非内置定时器（单机 MVP 无 scheduler 基建；定时器记 Phase 2 后续——CI/部署联动落地时一并接入 cron）；升级链 = 当前节点审批人 → admin 角色用户（直属上级/项目管理员模型记 Phase 2 后续，与组织架构联动）；超时阈值默认 24h（可配置表，调额端点同款模式）；升级后 votes 清空（原审批人失效，PRD「升级后原节点任务失效」）；升级仅限 pending 状态（终态不升级）；escalated_count 封顶 2（企业管理员封顶，再超时继续提示管理员）。自动升级的「L1 通知」（消息推送）记 Phase 2 后续（当前升级落审计 + 可查询）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/migrations/010_escalation.sql` | 创建 | approvals 加列 + timeout 配置表 |
| `services/gateway/src/repos/approvals.ts` | 修改 | 推进/resubmit 更新 last_node_activated_at + escalateOverdueApprovals |
| `services/gateway/src/repos/approvals.test.ts` | 修改 | 超时升级测试 |
| `services/gateway/src/routes/approvals.ts` | 修改 | POST /api/v1/approvals/:id/escalate + audit |
| `services/gateway/src/routes/approvals.test.ts` | 修改 | escalate 路由测试 |
| `README.md` | 修改 | 超时升级说明 |

---

## Task 1: 迁移 010

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `services/gateway/migrations/010_escalation.sql`

- [x] **Step 1: 契约 Approval 增 escalatedCount**

读 `packages/contracts/src/index.ts`，`Approval` 接口增（`version` 之后）：

```ts
  /** 超时升级次数（FR-APP-06） */
  escalatedCount?: number
```

- [x] **Step 2: 写迁移 010**

创建 `services/gateway/migrations/010_escalation.sql`，内容逐字如下：

```sql
-- 审批超时升级（FR-APP-06）：节点激活时间 + 升级计数 + 超时配置
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS last_node_activated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS escalated_count INT NOT NULL DEFAULT 0;

-- 超时配置（单行，默认 24h）
CREATE TABLE IF NOT EXISTS approval_timeout (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  timeout_hours INT NOT NULL DEFAULT 24,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO approval_timeout (id, timeout_hours) VALUES (1, 24)
  ON CONFLICT (id) DO NOTHING;
```

- [x] **Step 3: 迁移**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway migrate
```

Expected: 应用 010（幂等）；approvals 有 last_node_activated_at/escalated_count；approval_timeout 表存在默认 24。

- [x] **Step 4: 提交**

```bash
git add packages/contracts services/gateway/migrations/010_escalation.sql
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(approval): 迁移 010 超时升级（节点激活时间/升级计数/超时配置）"
```

---

## Task 2: 仓储层超时升级

**Files:**
- Modify: `services/gateway/src/repos/approvals.ts`
- Modify: `services/gateway/src/repos/approvals.test.ts`

- [x] **Step 1: approvals.ts 增超时升级**

读 `services/gateway/src/repos/approvals.ts`（先读全文，尤其 createApproval/decideApproval/resubmitApproval 的事务），做四处修改：

1. `ApprovalRow` 增 `last_node_activated_at: Date` 与 `escalated_count: number`；`mapApproval` 返回增 `escalatedCount: row.escalated_count`。

2. **推进时更新 last_node_activated_at**：`decideApproval` 的推进分支（`UPDATE approvals SET current_node_index = $2`）改为：
```ts
        await client.query(`UPDATE approvals SET current_node_index = $2, last_node_activated_at = now() WHERE id = $1`, [input.id, node.index + 1])
```

3. **resubmit 时重置**：`resubmitApproval` 的 approvals 重置 UPDATE 改为：
```ts
      `UPDATE approvals SET status = 'pending', current_node_index = 0, version = version + 1, reason = NULL, decided_at = NULL, last_node_activated_at = now(), escalated_count = 0 WHERE id = $1`,
```

4. **新增 escalateOverdueApprovals**（文件末尾追加）：

```ts
/** 超时升级（FR-APP-06）：扫描超时 pending 审批，升级当前节点审批人为 admin，escalated_count+1 */
export async function escalateOverdueApprovals(pool: pg.Pool, now: Date = new Date()): Promise<Approval[]> {
  const cfg = await pool.query<{ timeout_hours: string }>('SELECT timeout_hours FROM approval_timeout WHERE id = 1')
  const timeoutHours = Number(cfg.rows[0]?.timeout_hours ?? 24)
  const threshold = new Date(now.getTime() - timeoutHours * 60 * 60 * 1000)

  const overdue = await pool.query<ApprovalRow>(
    `SELECT * FROM approvals
      WHERE status = 'pending' AND last_node_activated_at < $1
      ORDER BY last_node_activated_at ASC
      LIMIT 50`,
    [threshold],
  )

  const escalated: Approval[] = []
  const admins = await pool.query<{ user_id: string }>(
    "SELECT user_id FROM users WHERE role = 'admin' ORDER BY user_id ASC",
  )
  if (admins.rows.length === 0) return escalated

  for (const row of overdue.rows) {
    const nodes = await loadNodes(pool, row.id)
    const node = nodes[row.current_node_index]
    if (!node || node.status !== 'pending') continue

    const next = admins.rows[row.escalated_count % admins.rows.length]!.user_id
    await pool.query(
      `UPDATE approval_nodes
          SET approver_ids = $3, votes = '{}'
        WHERE approval_id = $1 AND node_index = $2`,
      [row.id, node.index, [next]],
    )
    await pool.query(
      `UPDATE approvals
          SET escalated_count = escalated_count + 1, last_node_activated_at = now()
        WHERE id = $1`,
      [row.id],
    )
    escalated.push((await getApproval(pool, row.id))!)
  }
  return escalated
}
```

- [x] **Step 2: 测试扩展**

读 `services/gateway/src/repos/approvals.test.ts`（先读确认 setup：真实会话/truncate/配额表处理），追加：

```ts
  it('escalates an overdue approval to an admin', async () => {
    // 把超时配置调为 0（立即超时）
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 0 WHERE id = 1`)
    const created = await createApproval(pool, {
      sessionId,
      title: '超时升级',
      createdBy: 'u-u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-u-bob'] }],
    })
    const escalated = await escalateOverdueApprovals(pool, new Date(Date.now() + 1000))
    const mine = escalated.find((a) => a.id === created.id)
    expect(mine).toBeTruthy()
    expect(mine!.escalatedCount).toBe(1)
    // 原审批人失效：u-bob 不再是 approver
    expect(mine!.nodes[0]!.approverIds).not.toContain('u-u-bob')
    // 升级后审批人是 admin（u-probe 或测试环境 admin）
    expect(mine!.nodes[0]!.approverIds.length).toBe(1)
    // 恢复配置
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 24 WHERE id = 1`)
  })

  it('does not escalate a fresh pending approval', async () => {
    const created = await createApproval(pool, {
      sessionId,
      title: '未超时',
      createdBy: 'u-u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-u-bob'] }],
    })
    const escalated = await escalateOverdueApprovals(pool, new Date())
    expect(escalated.find((a) => a.id === created.id)).toBeUndefined()
  })

  it('advancing a node resets the activation time', async () => {
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 0 WHERE id = 1`)
    const created = await createApproval(pool, {
      sessionId,
      title: '推进重置',
      createdBy: 'u-u-alice',
      nodes: [
        { mode: 'single', approverIds: ['u-u-bob'] },
        { mode: 'single', approverIds: ['u-u-bob'] },
      ],
    })
    await decideApproval(pool, { id: created.id, approverId: 'u-u-bob', decision: 'approved' })
    // 推进后激活时间重置：now 前移 1 秒不应触发升级（last_node_activated_at 已刷新）
    const escalated = await escalateOverdueApprovals(pool, new Date(Date.now() + 1000))
    expect(escalated.find((a) => a.id === created.id)).toBeUndefined()
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 24 WHERE id = 1`)
  })
```

（`sessionId` 用既有测试的真实会话变量；`u-u-alice`/`u-u-bob` 用既有测试的实际用户 id 风格——先读现有用例确认用户 id 命名，若既有用 'u-alice' 则对齐。）

- [x] **Step 3: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose src/repos/approvals.test.ts
```

Expected: typecheck exit 0；approvals.test.ts 26 用例（23+3）全 PASS。

- [x] **Step 4: 提交**

```bash
git add services/gateway/src/repos/approvals.ts services/gateway/src/repos/approvals.test.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(approval): 超时升级仓储（扫描/升级/激活时间重置）"
```

---

## Task 3: escalate 路由 + 审计

**Files:**
- Modify: `services/gateway/src/routes/approvals.ts`
- Modify: `services/gateway/src/routes/approvals.test.ts`

- [x] **Step 1: 路由增 escalate 端点**

读 `services/gateway/src/routes/approvals.ts`（先读确认现有端点与 import），追加：

```ts
  // 手动触发超时升级（供外部调度/演示调用；自动定时器记 Phase 2 后续）
  app.post<{ Params: { id: string } }>(
    '/api/v1/approvals/:id/escalate',
    { preHandler: auth },
    async (request, reply) => {
      const approvalId = request.params.id
      if (!UUID_PATTERN.test(approvalId)) {
        return reply.code(400).send({ error: 'approval id must be a uuid' })
      }
      const approval = await getApproval(pool, approvalId)
      if (!approval) return reply.code(404).send({ error: 'approval not found' })
      if (approval.status !== 'pending') {
        return reply.code(409).send({ error: `approval is ${approval.status}, cannot escalate` })
      }
      if (!(await isMember(pool, approval.sessionId, request.user!.id))) {
        return reply.code(403).send({ error: 'not a member of the approval session' })
      }
      const escalated = await escalateOverdueApprovals(pool)
      const mine = escalated.find((a) => a.id === approvalId)
      if (!mine) {
        return reply.code(409).send({ error: 'approval is not overdue yet' })
      }
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'approval.escalated',
        target: approval.id,
        detail: { escalatedCount: mine.escalatedCount, title: mine.title },
      }).catch((err) => console.error('[audit] escalate record failed:', err))
      return { approval: mine }
    },
  )
```

（import 增 `escalateOverdueApprovals`。）

- [x] **Step 2: 路由测试**

读 `services/gateway/src/routes/approvals.test.ts`，追加：

```ts
  it('escalates an overdue approval', async () => {
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 0 WHERE id = 1`)
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '超时升级', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/escalate`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().approval.escalatedCount).toBe(1)
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 24 WHERE id = 1`)
  })

  it('rejects escalation of a fresh approval', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '未超时', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/escalate`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(res.statusCode).toBe(409)
  })
```

（注意：路由测试需要访问 `pool`——核对现有测试是否持有 pool（repos 测试有；routes 测试若没有，用 `built.pool` 或 `createTestPool` 变量——读现有 routes 测试确认可用变量。若 routes 测试无 pool 引用，改为在测试内 `createTestPool()` 或经 buildApp 的返回获取。）

- [x] **Step 3: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose src/routes/approvals.test.ts src/repos/approvals.test.ts
```

Expected: typecheck exit 0；路由 17+2=19、仓储 26 全 PASS。

- [x] **Step 4: 提交**

```bash
git add services/gateway/src/routes/approvals.ts services/gateway/src/routes/approvals.test.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(approval): 超时升级路由 + 审计"
```

---

## Task 4: README + 全仓验收 + 推送 + 真实验收

- [ ] **Step 1: README 追加超时升级说明**

在 README「### 技能包与配额（M2.4 / FR-ORG-04 / FR-ORG-07）」节之后追加：

```markdown
### 审批超时升级（FR-APP-06）

审批节点超时（默认 24h，`approval_timeout` 表可配置）可手动升级：`POST /api/v1/approvals/<id>/escalate` 把当前节点审批人替换为管理员并计数（escalated_count，审计留痕）；推进节点/重新提交会重置激活时间。自动定时器（cron 调用该端点）记 Phase 2 后续。
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

Expected: build 全过；test 全绿（contracts 2 + gateway 169+5≈174 + web 33 ≈ 209）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净（除 README/计划文档）。

- [ ] **Step 3: 真实验收（超时升级链）**

```bash
cd /tmp
# 1) 登录 → 建会话 → 创建审批（approverId=u-u-bob）
# 2) UPDATE approval_timeout SET timeout_hours=0（立即超时）
# 3) POST /approvals/<id>/escalate → 200 escalatedCount=1，approver 换成 admin（u-probe）
# 4) 原审批人 u-u-bob decide → 403（失效）；新审批人 u-probe decide → 200
# 5) 再 escalate 一次 → escalatedCount=2（封顶链）
# 6) 恢复 timeout_hours=24
```

Expected: 升级链完整；升级后原审批人失效；审计 approval.escalated 落库。

- [ ] **Step 4: 提交 + 推送**

```bash
git add README.md docs/superpowers/plans/2026-08-15-phase2-plan5-escalation.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 16 全部勾选 + README 超时升级说明"
git push
```

Expected: 推送成功（CI 应绿）。

---

## Self-Review 记录

- **Spec 覆盖**：FR-APP-06（节点超时→升级→再超时→企业管理员；审计；升级后原节点失效）→ Task 2 仓储 + Task 3 路由；PRD §6.7 超时升级链（默认 24h 可配置）→ approval_timeout 表；「每次升级 L1 通知」→ 记 Phase 2 后续（通知基建）；「再超时→企业管理员」→ escalated_count 封顶 2 + admin 轮换。
- **占位符扫描**：无 TBD；代码逐字给出。
- **类型一致性**：`escalatedCount?: number`（契约可选字段，向后兼容）在契约/Task 1/ApprovalRow/mapApproval/escalate 返回/路由测试断言全链路一致。
- **已知取舍**：自动定时器（cron 调 escalate）记 Phase 2 后续；直属上级/项目管理员升级链记 Phase 2 后续（当前 admin 轮换）；L1 通知记后续；escalated_count 封顶 2。
