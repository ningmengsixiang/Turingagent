# Phase 3 · 计划 26：自动定时器（审批超时升级 cron）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地自动定时器（补 FR-APP-06「自动定时器记后续」）：进程内 cron 每小时自动执行 `escalateOverdueApprovals`（超时审批升级，此前仅手动端点），可配置 cron 表达式；调度器可独立测试（tick 函数导出）。升级通知（L1 消息）记后续。

**Architecture:** 新增依赖 `node-cron`（gateway）→ `src/scheduler.ts`：`runEscalationTick(pool)`（调 escalateOverdueApprovals + 日志，供测试直接调用）与 `startScheduler(pool, cronExpr?)`（node-cron 调度，默认 `0 * * * *` 每小时，返回 disposer）→ `src/index.ts` 入口 buildApp 后启动（**不进 buildApp**——测试环境不自动启动，避免定时器悬挂）。config 增 `escalationCron`（env `ESCALATION_CRON`，默认每小时）。测试：scheduler.test.ts——runEscalationTick 真实升级超时审批。

**Tech Stack:** `node-cron`（gateway 依赖）+ 现有 escalateOverdueApprovals。

**决策记录：** 定时器用进程内 node-cron（单实例 MVP；多副本部署时需分布式锁/外部调度记后续——多副本下多个 gateway 实例都会跑 cron 导致重复升级——**防护**：escalateOverdueApprovals 已有行锁（FOR UPDATE）+ escalated_count 递增，重复执行幂等（第二实例锁后看到已升级节点 non-pending 跳过）✓）；调度不进 buildApp（测试隔离）；cron 表达式可配置（env ESCALATION_CRON）；升级结果日志（console.info 记录升级数量）；L1 通知（消息推送）记后续；tick 手动触发仍可用（POST /approvals/:id/escalate 保留）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/package.json` | 修改 | 增 node-cron 依赖 |
| `services/gateway/src/config.ts` | 修改 | escalationCron 配置 |
| `services/gateway/src/scheduler.ts` | 创建 | runEscalationTick + startScheduler |
| `services/gateway/src/index.ts` | 修改 | 启动调度器 |
| `services/gateway/src/scheduler.test.ts` | 创建 | tick 测试 |
| `README.md` | 修改 | 自动定时器说明 |

---

## Task 1: 依赖 + 配置 + 调度器

**Files:**
- Modify: `services/gateway/package.json`
- Modify: `services/gateway/src/config.ts`
- Create: `services/gateway/src/scheduler.ts`

- [ ] **Step 1: 增 node-cron 依赖**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway add node-cron
pnpm --filter @ta/gateway add -D @types/node-cron
```

（或手改 package.json + pnpm install——用 pnpm add 自动更新 lockfile。）

- [ ] **Step 2: config.ts 增 escalationCron**

读 `services/gateway/src/config.ts`，Config 接口增 `escalationCron: string`，loadConfig 增：

```ts
  escalationCron: env.ESCALATION_CRON ?? '0 * * * *',
```

- [ ] **Step 3: 写 scheduler.ts**

创建 `services/gateway/src/scheduler.ts`：

```ts
import cron from 'node-cron'
import pg from 'pg'
import { escalateOverdueApprovals } from './repos/approvals.js'

/** 执行一轮超时升级（供调度与测试直接调用） */
export async function runEscalationTick(pool: pg.Pool): Promise<number> {
  const escalated = await escalateOverdueApprovals(pool)
  if (escalated.length > 0) {
    console.info(`[scheduler] escalated ${escalated.length} overdue approval(s): ${escalated.map((a) => a.id).join(', ')}`)
  }
  return escalated.length
}

/** 启动 cron 调度（默认每小时；返回 disposer 供停止） */
export function startScheduler(pool: pg.Pool, cronExpr = '0 * * * *'): { stop: () => void } {
  const task = cron.schedule(cronExpr, () => {
    void runEscalationTick(pool).catch((err) => console.error('[scheduler] escalation tick failed:', err))
  })
  console.info(`[scheduler] escalation cron started: ${cronExpr}`)
  return { stop: () => task.stop() }
}
```

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
```

Expected: typecheck exit 0。

- [ ] **Step 5: 提交**

```bash
git add services/gateway/package.json services/gateway/src/config.ts services/gateway/src/scheduler.ts pnpm-lock.yaml
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(scheduler): 审批超时升级 cron 调度器（可配置/可测试）"
```

---

## Task 2: 入口启动 + 测试

**Files:**
- Modify: `services/gateway/src/index.ts`
- Create: `services/gateway/src/scheduler.test.ts`

- [ ] **Step 1: index.ts 启动调度器**

读 `services/gateway/src/index.ts`（入口：buildApp + listen），在 buildApp 后启动：

```ts
import { startScheduler } from './scheduler.js'
// ...（buildApp 后）
  startScheduler(built.pool, built.config.escalationCron)
```

（核对 built 的字段名——server.ts 的 BuiltApp 含 pool/config？读现状；若无 pool 暴露，用 buildApp 返回的 pool 或另取。）

- [ ] **Step 2: scheduler.test.ts**

创建 `services/gateway/src/scheduler.test.ts`（复用 repos 测试风格：临时池/truncate/真实会话）：

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'
import { createApproval, escalateOverdueApprovals } from '../repos/approvals.js'
import { runEscalationTick } from './scheduler.js'

describe('scheduler', () => {
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
    // 建真实会话（审批 FK 需要）
    const session = await pool.query<{ id: string }>(
      `INSERT INTO sessions (kind, title, tenant_id) VALUES ('project', '调度测试', '00000000-0000-0000-0000-000000000001') RETURNING id`,
    )
    sessionId = session.rows[0]!.id
  })
  afterEach(async () => {
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 24 WHERE id = 1`)
  })

  it('escalates overdue approvals via tick', async () => {
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 0 WHERE id = 1`)
    await createApproval(pool, {
      sessionId,
      title: '超时自动升级',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    const count = await runEscalationTick(pool, new Date(Date.now() + 1000))
    expect(count).toBeGreaterThanOrEqual(1)
    await pool.query(`UPDATE approval_timeout SET timeout_hours = 24 WHERE id = 1`)
  })

  it('does not escalate fresh approvals', async () => {
    await createApproval(pool, {
      sessionId,
      title: '未超时',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    const count = await runEscalationTick(pool)
    expect(count).toBe(0)
  })
})
```

> 注：`runEscalationTick` 的 `now` 参数——escalateOverdueApprovals 接受 now 但 runEscalationTick 未透传（计划 Step 3 代码）——测试用 `new Date(Date.now() + 1000)` 需透传。**修正**：runEscalationTick 加可选 `now` 参数透传（`runEscalationTick(pool, now?)` → `escalateOverdueApprovals(pool, now)`），实现时按此。

- [ ] **Step 3: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose src/scheduler.test.ts
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；scheduler.test.ts 2 用例全 PASS；全量 gateway 203 用例（201+2）全 PASS。

- [ ] **Step 4: 提交**

```bash
git add services/gateway/src/index.ts services/gateway/src/scheduler.ts services/gateway/src/scheduler.test.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(scheduler): 入口启动 cron + tick 测试"
```

---

## Task 3: README + 全仓验收 + 推送

- [ ] **Step 1: README 追加「自动定时器」说明**

在 README「### K8s 部署（M2.5 扩展）」节之后追加：

```markdown
### 自动定时器（审批超时升级）

进程内 cron（node-cron，默认每小时，`ESCALATION_CRON` 可配 cron 表达式）自动执行超时审批升级（FR-APP-06 自动触发，此前仅手动端点）；升级幂等（行锁 + escalated_count，多副本安全）。L1 升级通知记后续。
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

Expected: build 全过；test 全绿（contracts 2 + gateway 203 + web 34 ≈ 239）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净。

- [ ] **Step 3: 真实验收**

```bash
cd /tmp
# 1) 启动 gateway → 日志出现 "[scheduler] escalation cron started: 0 * * * *"
# 2) 调额 approval_timeout=0 + 建审批 → 等 cron 触发（或手动验证 tick 已由测试覆盖）
# 3) 或直接验证：调 ESCALATION_CRON='*/1 * * * *' 每分钟触发 → 观察日志 escalated N
```

（真实 cron 触发等待较长——验收以「启动日志 cron started」+ 测试覆盖 tick 逻辑为准；如需实时验证用 ESCALATION_CRON 每分钟。）

- [ ] **Step 4: 提交 + 推送**

```bash
git add README.md docs/superpowers/plans/2026-08-15-phase3-plan8-scheduler.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 26 全部勾选 + README 自动定时器说明"
git push
```

Expected: 推送成功（CI 应绿）。

---

## Self-Review 记录

- **Spec 覆盖**：FR-APP-06（超时自动升级）自动触发闭环（此前仅手动端点 + 记录「自动定时器记后续」）→ cron 调度；「每次升级 L1 通知」→ 记后续（通知基建）；多副本幂等（行锁）→ 决策记录分析。
- **占位符扫描**：无 TBD；代码逐字给出（runEscalationTick now 透传修正已在注说明）。
- **类型一致性**：escalationCron 在 config/startScheduler/测试一致；runEscalationTick 返回 number（升级数）在调度/测试一致。
- **已知取舍**：进程内 cron（单实例；多副本分布式锁记后续，行锁幂等兜底）；调度不进 buildApp（测试隔离，index.ts 入口启动）；L1 通知记后续；手动 escalate 端点保留。
