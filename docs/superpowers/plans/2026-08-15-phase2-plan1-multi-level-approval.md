# Phase 2 · 计划 12：多级审批引擎（M2.1，FR-APP-02）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把单级审批升级为多级审批引擎（FR-APP-02/BL-4）：支持单人（single）/会签（all）/或签（any）三种节点模式、串行多级推进、转办、驳回修改（RETURNED → 发起人重提，版本 +1）、发起人撤销（FR-APP-05）；审批人必须是人类（API 层拒绝 agent）。

**Architecture:** 新增 `approval_nodes` 表建模流程节点（approval 为流程实例，`current_node_index` 指向激活节点），`approvals` 表加 `mode/current_node_index/version` 列（保持向后兼容：无 nodes 的创建 = 单级 single 节点）；仓储层实现状态机（decide 按节点模式聚合投票/推进/终止；return 置 RETURNED；resubmit 版本+1 全流程重置；transfer 换当前节点审批人；cancel 撤销）；路由层新增 transfer/return/resubmit/cancel 端点 + 人类审批人校验（拒绝 `agent-` 前缀 id）；前端审批卡片渲染节点进度列表 + 通过/驳回/转办/重提/撤销操作。超时升级（FR-APP-06）与待办中心（FR-APP-04）记入后续计划。

**Tech Stack:** 无新依赖。PG（approval_nodes 表 + JSONB votes 聚合投票）+ 契约类型扩展 + Fastify 路由 + React 卡片。

**决策记录：** 节点级投票用 `votes JSONB`（键=审批人 id，值=approved/rejected），支持会签多人逐票聚合，一人一票（重复裁决抛 ALREADY_DECIDED）；状态机规则：single 通过→推进/驳回→整体 REJECTED；all 全部通过→推进、任一驳回→整体 REJECTED；any 任一通过→推进、全部驳回→整体 REJECTED；末节点通过→APPROVED。RETURNED 语义=当前节点审批人发起「修改意见」→ 流程挂起等发起人 resubmit（版本+1、全部节点与投票重置、current_node_index=0，重走全流程）；TRANSFER 语义=当前节点审批人把节点审批人替换为指定人类（approver_ids=[新审批人]、投票清空、audit 留痕）；CANCEL 仅发起人可操作（pending/returned 状态）。人类审批人校验：approver id 以 `agent-` 开头 → 400（PRD：审批人必须是人类，智能体只可附意见）。向后兼容：`createApproval` 保持签名（内部构造单级 single 节点），路由 `POST /approvals` 增可选 `nodes` 数组。前端转办用会话成员列表选择器（复用 members 状态），不做独立选人弹层（记 Phase 2 后续）。超时升级/待办中心/多级可视化配置（P2）记入后续计划。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `packages/contracts/src/index.ts` | 修改 | ApprovalNode/ApprovalNodeMode + Approval 扩展（mode/currentNodeIndex/version/nodes）+ ApprovalStatus 扩 returned/cancelled |
| `services/gateway/migrations/008_approval_flow.sql` | 创建 | approvals ALTER + approval_nodes 表 |
| `services/gateway/src/repos/approvals.ts` | 修改 | 多级状态机（createApprovalFlow/decideApproval/transferApproval/returnApproval/resubmitApproval/cancelApproval） |
| `services/gateway/src/repos/approvals.test.ts` | 修改 | 仓储状态机测试 |
| `services/gateway/src/routes/approvals.ts` | 修改 | nodes 创建 + transfer/return/resubmit/cancel 端点 + 人类校验 |
| `services/gateway/src/routes/approvals.test.ts` | 修改 | 路由测试 |
| `apps/web/src/api/client.ts` | 修改 | transferApproval/returnApproval/resubmitApproval/cancelApproval API |
| `apps/web/src/pages/Chat.tsx` | 修改 | 卡片节点进度渲染 + 操作按钮（转办/重提/撤销/驳回修改） |
| `apps/web/src/pages/Chat.test.tsx` | 修改 | 卡片交互用例 |
| `README.md` | 修改 | 多级审批说明 |

---

## Task 1: 契约 + 迁移 008

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `services/gateway/migrations/008_approval_flow.sql`

- [ ] **Step 1: 契约扩展**

读 `packages/contracts/src/index.ts`，把 ApprovalStatus 与 Approval 替换为（保留 TaskStatus 等不动）：

```ts
export const ApprovalStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
  Returned: 'returned',
  Cancelled: 'cancelled',
} as const
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus]

export const ApprovalNodeMode = {
  Single: 'single',
  All: 'all',
  Any: 'any',
} as const
export type ApprovalNodeMode = (typeof ApprovalNodeMode)[keyof typeof ApprovalNodeMode]

export const ApprovalNodeStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
} as const
export type ApprovalNodeStatus = (typeof ApprovalNodeStatus)[keyof typeof ApprovalNodeStatus]

export interface ApprovalNode {
  /** 节点序号（0 起，串行顺序） */
  index: number
  /** 单人/会签/或签 */
  mode: ApprovalNodeMode
  /** 审批人（人类，不得为 agent） */
  approverIds: string[]
  status: ApprovalNodeStatus
  /** 最终裁决人（节点完成后） */
  decidedBy?: string
  reason?: string
  decidedAt?: string
}

export interface Approval {
  id: string
  sessionId: string
  title: string
  description?: string
  status: ApprovalStatus
  /** 兼容字段：当前激活节点（currentNode）的第一个审批人；单级 = 原 approverId */
  approverId: string
  createdBy: string
  reason?: string
  createdAt: string
  decidedAt?: string
  /** 顶层模式（单节点时 = 该节点 mode） */
  mode: ApprovalNodeMode
  /** 当前激活节点序号 */
  currentNodeIndex: number
  /** 重提版本（resubmit 后 +1） */
  version: number
  /** 流程节点列表（按 index 升序） */
  nodes: ApprovalNode[]
}

export const isApprovalNodeMode = (v: unknown): v is ApprovalNodeMode =>
  typeof v === 'string' && (Object.values(ApprovalNodeMode) as string[]).includes(v)
```

- [ ] **Step 2: 写迁移 008**

创建 `services/gateway/migrations/008_approval_flow.sql`，内容逐字如下：

```sql
-- 多级审批引擎（FR-APP-02）：approvals 加流程字段 + approval_nodes 表
ALTER TABLE approvals
  DROP CONSTRAINT IF EXISTS approvals_status_check;
ALTER TABLE approvals
  ADD CONSTRAINT approvals_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'returned', 'cancelled'));

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'single'
  CHECK (mode IN ('single', 'all', 'any'));
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS current_node_index INT NOT NULL DEFAULT 0;
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS approval_nodes (
  approval_id UUID NOT NULL REFERENCES approvals (id) ON DELETE CASCADE,
  node_index INT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('single', 'all', 'any')),
  approver_ids TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  votes JSONB NOT NULL DEFAULT '{}',
  decided_by TEXT,
  reason TEXT,
  decided_at TIMESTAMPTZ,
  PRIMARY KEY (approval_id, node_index)
);

CREATE INDEX IF NOT EXISTS idx_approval_nodes_approval ON approval_nodes (approval_id);
```

- [ ] **Step 3: 构建契约 + 迁移**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway migrate
```

Expected: contracts build exit 0；typecheck exit 0（此时 repos/approvals.ts 的 mapApproval 未返回新字段——typecheck 可能报 Approval 缺字段；**预期会报错**：`mapApproval` 返回类型不满足新 Approval。若报错，这是预期的中间态——不修，等 Task 2 重写 repos；若未报错说明 contracts build 未生效，检查 `packages/contracts/lib` 已重新构建。typecheck 若失败属预期，记录后继续 Task 2）；migrate 应用 008（advisory lock 幂等，重复跑无变化）。

> 注：Task 1 结束时 typecheck **允许失败**（中间态），commit 前不要求全绿。若你希望保持每 commit 绿，可在 Task 2 一起提交。

- [ ] **Step 4: 提交**

```bash
git add packages/contracts services/gateway/migrations/008_approval_flow.sql
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(approval): 契约多级审批类型 + 迁移 008（approval_nodes）"
```

---

## Task 2: 仓储层多级状态机

**Files:**
- Modify: `services/gateway/src/repos/approvals.ts`
- Modify: `services/gateway/src/repos/approvals.test.ts`

- [ ] **Step 1: 重写 repos/approvals.ts**

读 `services/gateway/src/repos/approvals.ts`，整体替换为（保留 ApprovalStateError/ApprovalErrorCode 结构，错误码扩展）：

```ts
import pg from 'pg'
import type { Approval, ApprovalNode, ApprovalNodeMode, ApprovalStatus } from '@ta/contracts'

export interface ApprovalRow {
  id: string
  session_id: string
  title: string
  description: string
  status: string
  approver_id: string
  created_by: string
  reason: string | null
  decided_at: Date | null
  created_at: Date
  mode: string
  current_node_index: number
  version: number
}

export interface ApprovalNodeRow {
  approval_id: string
  node_index: number
  mode: string
  approver_ids: string[]
  status: string
  votes: Record<string, string>
  decided_by: string | null
  reason: string | null
  decided_at: Date | null
}

export function mapApprovalNode(row: ApprovalNodeRow): ApprovalNode {
  return {
    index: row.node_index,
    mode: row.mode as ApprovalNodeMode,
    approverIds: row.approver_ids,
    status: row.status as ApprovalNode['status'],
    decidedBy: row.decided_by ?? undefined,
    reason: row.reason ?? undefined,
    decidedAt: row.decided_at?.toISOString(),
  }
}

export function mapApproval(row: ApprovalRow, nodes: ApprovalNode[]): Approval {
  const current = nodes.find((n) => n.index === row.current_node_index)
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    description: row.description || undefined,
    status: row.status as ApprovalStatus,
    approverId: current?.approverIds[0] ?? row.approver_id,
    createdBy: row.created_by,
    reason: row.reason ?? undefined,
    createdAt: row.created_at.toISOString(),
    decidedAt: row.decided_at?.toISOString(),
    mode: row.mode as ApprovalNodeMode,
    currentNodeIndex: row.current_node_index,
    version: row.version,
    nodes,
  }
}

export type ApprovalErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_DECIDED'
  | 'NOT_APPROVER'
  | 'NOT_PENDING'
  | 'NOT_OWNER'
  | 'AGENT_NOT_ALLOWED'

export class ApprovalStateError extends Error {
  readonly code: ApprovalErrorCode

  constructor(code: ApprovalErrorCode, message: string) {
    super(message)
    this.name = 'ApprovalStateError'
    this.code = code
  }
}

export interface ApprovalNodeInput {
  mode: ApprovalNodeMode
  approverIds: string[]
}

async function loadNodes(pool: pg.Pool, approvalId: string): Promise<ApprovalNode[]> {
  const res = await pool.query<ApprovalNodeRow>(
    'SELECT * FROM approval_nodes WHERE approval_id = $1 ORDER BY node_index ASC',
    [approvalId],
  )
  return res.rows.map(mapApprovalNode)
}

async function getApprovalRow(pool: pg.Pool, id: string): Promise<ApprovalRow | null> {
  const res = await pool.query<ApprovalRow>('SELECT * FROM approvals WHERE id = $1', [id])
  return res.rows[0] ?? null
}

/** 校验审批人必须是人类（PRD：agent 只有建议权） */
function assertHumanApprovers(approverIds: string[]): void {
  for (const id of approverIds) {
    if (id.startsWith('agent-')) {
      throw new ApprovalStateError('AGENT_NOT_ALLOWED', `approver must be a human, got ${id}`)
    }
  }
}

export async function createApproval(
  pool: pg.Pool,
  input: {
    sessionId: string
    title: string
    description?: string
    approverId?: string
    nodes?: ApprovalNodeInput[]
    createdBy: string
  },
): Promise<Approval> {
  // 向后兼容：无 nodes 时按单级 single（approverId 必填）
  const flow: ApprovalNodeInput[] =
    input.nodes && input.nodes.length > 0
      ? input.nodes
      : [{ mode: 'single', approverIds: input.approverId ? [input.approverId] : [] }]
  if (flow.length === 0) throw new ApprovalStateError('NOT_APPROVER', 'approval flow must have at least one node')
  for (const node of flow) {
    if (node.approverIds.length === 0) throw new ApprovalStateError('NOT_APPROVER', 'each node needs at least one approver')
    assertHumanApprovers(node.approverIds)
  }
  const mode = flow.length === 1 ? flow[0]!.mode : flow[0]!.mode

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const res = await client.query<ApprovalRow>(
      `INSERT INTO approvals (session_id, title, description, approver_id, created_by, mode)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.sessionId, input.title, input.description ?? '', flow[0]!.approverIds[0]!, input.createdBy, mode],
    )
    const row = res.rows[0]!
    for (const [i, node] of flow.entries()) {
      await client.query(
        `INSERT INTO approval_nodes (approval_id, node_index, mode, approver_ids)
         VALUES ($1, $2, $3, $4)`,
        [row.id, i, node.mode, node.approverIds],
      )
    }
    await client.query('COMMIT')
    const nodes = await loadNodes(pool, row.id)
    return mapApproval(row, nodes)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getApproval(pool: pg.Pool, id: string): Promise<Approval | null> {
  const row = await getApprovalRow(pool, id)
  if (!row) return null
  const nodes = await loadNodes(pool, id)
  return mapApproval(row, nodes)
}

/** 裁决当前激活节点；按模式聚合推进（single/all/any），末节点通过 → approved */
export async function decideApproval(
  pool: pg.Pool,
  input: { id: string; approverId: string; decision: 'approved' | 'rejected'; reason?: string },
): Promise<Approval> {
  const row = await getApprovalRow(pool, input.id)
  if (!row) throw new ApprovalStateError('NOT_FOUND', 'approval not found')
  if (row.status !== 'pending') throw new ApprovalStateError('NOT_PENDING', `approval is ${row.status}, not pending`)
  const nodes = await loadNodes(pool, input.id)
  const node = nodes[row.current_node_index]
  if (!node) throw new ApprovalStateError('NOT_FOUND', `node ${row.current_node_index} not found`)
  if (node.status !== 'pending') throw new ApprovalStateError('ALREADY_DECIDED', `node ${node.index} already ${node.status}`)
  if (!node.approverIds.includes(input.approverId)) {
    throw new ApprovalStateError('NOT_APPROVER', 'only a current-node approver can decide')
  }
  if (node.votes[input.approverId]) {
    throw new ApprovalStateError('ALREADY_DECIDED', `approver ${input.approverId} already voted`)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // 并发双裁决竞态修复：行锁串行化（先到者获胜，后到者重读抛 ALREADY_DECIDED/NOT_PENDING）
    const lock = await client.query<ApprovalRow>('SELECT id FROM approvals WHERE id = $1 FOR UPDATE', [input.id])
    if (lock.rowCount !== 1) throw new ApprovalStateError('NOT_FOUND', 'approval not found')
    const fresh = await client.query<ApprovalNodeRow>(
      `SELECT * FROM approval_nodes WHERE approval_id = $1 AND node_index = $2`,
      [input.id, node.index],
    )
    const freshVotes = (fresh.rows[0]?.votes ?? {}) as Record<string, string>
    if (fresh.rows[0] && fresh.rows[0].status !== 'pending') {
      throw new ApprovalStateError('ALREADY_DECIDED', `node ${node.index} already ${fresh.rows[0].status}`)
    }
    if (freshVotes[input.approverId]) {
      throw new ApprovalStateError('ALREADY_DECIDED', `approver ${input.approverId} already voted`)
    }
    const votes = { ...freshVotes, [input.approverId]: input.decision }
    await client.query(
      `UPDATE approval_nodes SET votes = $3, reason = $4 WHERE approval_id = $1 AND node_index = $2`,
      [input.id, node.index, votes, input.reason ?? null],
    )

    let nodeStatus: 'approved' | 'rejected' | null = null
    if (node.mode === 'single') {
      nodeStatus = input.decision
    } else if (node.mode === 'all') {
      const allVoted = node.approverIds.every((a) => votes[a])
      if (allVoted) {
        nodeStatus = node.approverIds.some((a) => votes[a] === 'rejected') ? 'rejected' : 'approved'
      }
    } else {
      // any：任一 approved 即过；全部 rejected 才拒
      if (Object.values(votes).includes('approved')) {
        nodeStatus = 'approved'
      } else if (node.approverIds.every((a) => votes[a])) {
        nodeStatus = 'rejected'
      }
    }

    if (nodeStatus) {
      await client.query(
        `UPDATE approval_nodes
            SET status = $3, decided_by = $4, decided_at = now()
          WHERE approval_id = $1 AND node_index = $2`,
        [input.id, node.index, nodeStatus, input.approverId],
      )
      if (nodeStatus === 'rejected') {
        await client.query(
          `UPDATE approvals SET status = 'rejected', reason = $2, decided_at = now() WHERE id = $1`,
          [input.id, input.reason ?? null],
        )
      } else if (node.index === nodes.length - 1) {
        await client.query(
          `UPDATE approvals SET status = 'approved', decided_at = now() WHERE id = $1`,
          [input.id],
        )
      } else {
        await client.query(`UPDATE approvals SET current_node_index = $2 WHERE id = $1`, [input.id, node.index + 1])
      }
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return (await getApproval(pool, input.id))!
}

/** 转办：当前节点审批人把节点审批人替换为指定人类（原投票清空，audit 由路由层留痕） */
export async function transferApproval(
  pool: pg.Pool,
  input: { id: string; operatorId: string; newApproverId: string },
): Promise<Approval> {
  const row = await getApprovalRow(pool, input.id)
  if (!row) throw new ApprovalStateError('NOT_FOUND', 'approval not found')
  if (row.status !== 'pending') throw new ApprovalStateError('NOT_PENDING', `approval is ${row.status}, not pending`)
  const nodes = await loadNodes(pool, input.id)
  const node = nodes[row.current_node_index]!
  if (node.status !== 'pending') throw new ApprovalStateError('ALREADY_DECIDED', `node ${node.index} already ${node.status}`)
  if (!node.approverIds.includes(input.operatorId)) {
    throw new ApprovalStateError('NOT_APPROVER', 'only a current-node approver can transfer')
  }
  assertHumanApprovers([input.newApproverId])
  await pool.query(
    `UPDATE approval_nodes
        SET approver_ids = $3, votes = '{}'
      WHERE approval_id = $1 AND node_index = $2`,
    [input.id, node.index, [input.newApproverId]],
  )
  return (await getApproval(pool, input.id))!
}

/** 驳回修改：当前节点审批人发起，流程挂起等发起人重提 */
export async function returnApproval(
  pool: pg.Pool,
  input: { id: string; operatorId: string; reason: string },
): Promise<Approval> {
  const row = await getApprovalRow(pool, input.id)
  if (!row) throw new ApprovalStateError('NOT_FOUND', 'approval not found')
  if (row.status !== 'pending') throw new ApprovalStateError('NOT_PENDING', `approval is ${row.status}, not pending`)
  const nodes = await loadNodes(pool, input.id)
  const node = nodes[row.current_node_index]!
  if (node.status !== 'pending') throw new ApprovalStateError('ALREADY_DECIDED', `node ${node.index} already ${node.status}`)
  if (!node.approverIds.includes(input.operatorId)) {
    throw new ApprovalStateError('NOT_APPROVER', 'only a current-node approver can return')
  }
  await pool.query(`UPDATE approvals SET status = 'returned', reason = $2 WHERE id = $1`, [input.id, input.reason])
  return (await getApproval(pool, input.id))!
}

/** 重新提交：发起人重提，版本 +1，全流程与投票重置 */
export async function resubmitApproval(pool: pg.Pool, input: { id: string; operatorId: string }): Promise<Approval> {
  const row = await getApprovalRow(pool, input.id)
  if (!row) throw new ApprovalStateError('NOT_FOUND', 'approval not found')
  if (row.status !== 'returned') throw new ApprovalStateError('NOT_PENDING', `approval is ${row.status}, only returned can resubmit`)
  if (row.created_by !== input.operatorId) {
    throw new ApprovalStateError('NOT_OWNER', 'only the creator can resubmit')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE approvals SET status = 'pending', current_node_index = 0, version = version + 1, reason = NULL, decided_at = NULL WHERE id = $1`,
      [input.id],
    )
    await client.query(
      `UPDATE approval_nodes SET status = 'pending', votes = '{}', decided_by = NULL, reason = NULL, decided_at = NULL WHERE approval_id = $1`,
      [input.id],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return (await getApproval(pool, input.id))!
}

/** 撤销：仅发起人可操作（pending/returned 状态） */
export async function cancelApproval(pool: pg.Pool, input: { id: string; operatorId: string }): Promise<Approval> {
  const row = await getApprovalRow(pool, input.id)
  if (!row) throw new ApprovalStateError('NOT_FOUND', 'approval not found')
  if (row.status !== 'pending' && row.status !== 'returned') {
    throw new ApprovalStateError('NOT_PENDING', `approval is ${row.status}, cannot cancel`)
  }
  if (row.created_by !== input.operatorId) {
    throw new ApprovalStateError('NOT_OWNER', 'only the creator can cancel')
  }
  await pool.query(`UPDATE approvals SET status = 'cancelled', decided_at = now() WHERE id = $1`, [input.id])
  return (await getApproval(pool, input.id))!
}
```

> 注 2（编译适配）：契约 `ApprovalNode` 无 `votes` 字段（votes 仅存 DB），`loadNodes` 内部返回 `ApprovalNode & { votes: Record<string,string> }`（对外映射为 ApprovalNode 时剥离 votes）；`decideApproval` 事务内以 `SELECT ... FOR UPDATE` 行锁串行化并发裁决（先到者获胜，后到者重读抛 ALREADY_DECIDED）——这是对既有「恰一次决策」并发保证的延续（T2 实现者发现计划初稿丢失此保证，按方案 A 修复）。

> 注：`mapApproval` 签名变了（`nodes` 参数）——路由层与测试的调用要相应调整（Task 3）。`createApproval` 保持函数名但签名扩展（nodes 可选）。`ApprovalRow` 增了 mode/current_node_index/version 列。

- [ ] **Step 2: 扩展仓储测试**

读 `services/gateway/src/repos/approvals.test.ts`（先读确认 setup：临时池/truncateAll），在既有用例后追加：

```ts
  it('advances through serial single nodes to approved', async () => {
    const created = await createApproval(pool, {
      sessionId: 's-multi-1',
      title: '两级串行',
      createdBy: 'u-alice',
      nodes: [
        { mode: 'single', approverIds: ['u-bob'] },
        { mode: 'single', approverIds: ['u-carol'] },
      ],
    })
    expect(created.status).toBe('pending')
    expect(created.currentNodeIndex).toBe(0)
    expect(created.nodes).toHaveLength(2)

    const afterFirst = await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })
    expect(afterFirst.status).toBe('pending')
    expect(afterFirst.currentNodeIndex).toBe(1)
    expect(afterFirst.nodes[0]!.status).toBe('approved')

    const afterSecond = await decideApproval(pool, { id: created.id, approverId: 'u-carol', decision: 'approved' })
    expect(afterSecond.status).toBe('approved')
    expect(afterSecond.nodes[1]!.status).toBe('approved')
  })

  it('rejects the whole flow when a single node rejects', async () => {
    const created = await createApproval(pool, {
      sessionId: 's-multi-2',
      title: '串行驳回',
      createdBy: 'u-alice',
      nodes: [
        { mode: 'single', approverIds: ['u-bob'] },
        { mode: 'single', approverIds: ['u-carol'] },
      ],
    })
    const after = await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'rejected', reason: '方案不可行' })
    expect(after.status).toBe('rejected')
    expect(after.reason).toBe('方案不可行')
  })

  it('countersign (all) needs every approver and rejects on any reject', async () => {
    const created = await createApproval(pool, {
      sessionId: 's-multi-3',
      title: '会签',
      createdBy: 'u-alice',
      nodes: [{ mode: 'all', approverIds: ['u-bob', 'u-carol'] }],
    })
    const oneVote = await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })
    expect(oneVote.status).toBe('pending') // 未齐票不推进

    const rejected = await decideApproval(pool, { id: created.id, approverId: 'u-carol', decision: 'rejected' })
    expect(rejected.status).toBe('rejected')
  })

  it('or-sign (any) approves on first approval and rejects only when all reject', async () => {
    const created = await createApproval(pool, {
      sessionId: 's-multi-4',
      title: '或签',
      createdBy: 'u-alice',
      nodes: [{ mode: 'any', approverIds: ['u-bob', 'u-carol'] }],
    })
    const approved = await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })
    expect(approved.status).toBe('approved')

    const created2 = await createApproval(pool, {
      sessionId: 's-multi-5',
      title: '或签全拒',
      createdBy: 'u-alice',
      nodes: [{ mode: 'any', approverIds: ['u-bob', 'u-carol'] }],
    })
    const r1 = await decideApproval(pool, { id: created2.id, approverId: 'u-bob', decision: 'rejected' })
    expect(r1.status).toBe('pending')
    const r2 = await decideApproval(pool, { id: created2.id, approverId: 'u-carol', decision: 'rejected' })
    expect(r2.status).toBe('rejected')
  })

  it('rejects double voting by the same approver', async () => {
    const created = await createApproval(pool, {
      sessionId: 's-multi-6',
      title: '重复投票',
      createdBy: 'u-alice',
      nodes: [{ mode: 'all', approverIds: ['u-bob', 'u-carol'] }],
    })
    await decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })
    await expect(decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })).rejects.toMatchObject({
      code: 'ALREADY_DECIDED',
    })
  })

  it('transfers the current node approver', async () => {
    const created = await createApproval(pool, {
      sessionId: 's-multi-7',
      title: '转办',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    const transferred = await transferApproval(pool, { id: created.id, operatorId: 'u-bob', newApproverId: 'u-carol' })
    expect(transferred.nodes[0]!.approverIds).toEqual(['u-carol'])
    // 原审批人不再能裁决
    await expect(decideApproval(pool, { id: created.id, approverId: 'u-bob', decision: 'approved' })).rejects.toMatchObject({
      code: 'NOT_APPROVER',
    })
  })

  it('returns for revision and resubmits with version +1', async () => {
    const created = await createApproval(pool, {
      sessionId: 's-multi-8',
      title: '驳回修改',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    const returned = await returnApproval(pool, { id: created.id, operatorId: 'u-bob', reason: '请补充预算' })
    expect(returned.status).toBe('returned')

    const resubmitted = await resubmitApproval(pool, { id: created.id, operatorId: 'u-alice' })
    expect(resubmitted.status).toBe('pending')
    expect(resubmitted.version).toBe(2)
    expect(resubmitted.currentNodeIndex).toBe(0)
  })

  it('cancels only by the creator while pending', async () => {
    const created = await createApproval(pool, {
      sessionId: 's-multi-9',
      title: '撤销',
      createdBy: 'u-alice',
      nodes: [{ mode: 'single', approverIds: ['u-bob'] }],
    })
    await expect(cancelApproval(pool, { id: created.id, operatorId: 'u-bob' })).rejects.toMatchObject({ code: 'NOT_OWNER' })
    const cancelled = await cancelApproval(pool, { id: created.id, operatorId: 'u-alice' })
    expect(cancelled.status).toBe('cancelled')
  })

  it('rejects agent approvers', async () => {
    await expect(
      createApproval(pool, {
        sessionId: 's-multi-10',
        title: 'agent 审批',
        createdBy: 'u-alice',
        nodes: [{ mode: 'single', approverIds: ['agent-ta-pm'] }],
      }),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_ALLOWED' })
  })
```

（注意：会话 id `s-multi-*` 只是仓储层不校验外键；既有测试若用真实会话 id，保持既有风格。若该文件测试不需要真实 session，直接按上述写；若 createApproval 在测试里不校验 session 存在——核对既有测试的 sessionId 用法后对齐。既有用例的 sessionId 可能用 's1' 之类的占位——先读文件确认。）

- [ ] **Step 3: 跑仓储测试**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose src/repos/approvals.test.ts
```

Expected: contracts build exit 0；typecheck exit 0；approvals.test.ts 既有 7 用例 + 新增 9 = 16 用例全 PASS。**注意**：既有用例可能调用 `decideApproval`/`createApproval` 旧签名——若 typecheck 报错，先读报错按新签名修既有测试（`createApproval` 的 input 现为 `{sessionId,title,description?,approverId?,nodes?,createdBy}`，`decideApproval` 不变；`getApproval` 返回新结构不影响断言字段）。

- [ ] **Step 4: 提交**

```bash
git add services/gateway/src/repos/approvals.ts services/gateway/src/repos/approvals.test.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(approval): 多级审批状态机（会签/或签/转办/驳回重提/撤销）"
```

---

## Task 3: 路由层（nodes 创建 + 操作端点 + 人类校验）

**Files:**
- Modify: `services/gateway/src/routes/approvals.ts`
- Modify: `services/gateway/src/routes/approvals.test.ts`

- [ ] **Step 1: 重写 routes/approvals.ts（含 GET 详情端点）**

读 `services/gateway/src/routes/approvals.ts`，整体替换为（保留 findCardMessageId；增 GET /api/v1/approvals/:id 详情端点供前端节点进度渲染；createApproval 传 nodes）：

```ts
import type { FastifyInstance } from 'fastify'
import type { Message } from '@ta/contracts'
import { isApprovalNodeMode } from '@ta/contracts'
import { requireAuth } from '../middleware.js'
import { isMember } from '../repos/sessions.js'
import { createMessage, updateMessageContent } from '../repos/messages.js'
import {
  createApproval,
  getApproval,
  decideApproval,
  transferApproval,
  returnApproval,
  resubmitApproval,
  cancelApproval,
  ApprovalStateError,
} from '../repos/approvals.js'
import { recordAudit } from '../repos/audit.js'
import type { Config } from '../config.js'
import pg from 'pg'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_NODES = 10

export function registerApprovalRoutes(
  app: FastifyInstance,
  config: Config,
  pool: pg.Pool,
  emitMessageCreated: (message: Message) => void,
  emitMessageUpdated: (message: Message) => void,
): void {
  const auth = requireAuth(config, pool)

  app.post<{ Params: { id: string }; Body: { title?: string; description?: string; approverId?: string; nodes?: Array<{ mode?: string; approverIds?: string[] }> } }>(
    '/api/v1/sessions/:id/approvals',
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
      if (!title || title.length > 200) {
        return reply.code(400).send({ error: 'title is required (<=200 chars)' })
      }
      const nodes = request.body?.nodes
      if (nodes !== undefined) {
        if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > MAX_NODES) {
          return reply.code(400).send({ error: `nodes must be an array of 1-${MAX_NODES} items` })
        }
        for (const [i, n] of nodes.entries()) {
          if (!n || !isApprovalNodeMode(n.mode) || !Array.isArray(n.approverIds) || n.approverIds.length === 0) {
            return reply.code(400).send({ error: `node ${i} needs mode and non-empty approverIds` })
          }
          for (const a of n.approverIds) {
            if (!(await isMember(pool, sessionId, a))) {
              return reply.code(400).send({ error: `node ${i} approver ${a} is not a member of this session` })
            }
          }
        }
      }
      const approverId = request.body?.approverId?.trim()
      if (nodes === undefined && !approverId) {
        return reply.code(400).send({ error: 'approverId is required when nodes is absent' })
      }
      if (approverId && !(await isMember(pool, sessionId, approverId))) {
        return reply.code(400).send({ error: 'approver must be a member of this session' })
      }
      try {
        const approval = await createApproval(pool, {
          sessionId,
          title,
          description: request.body?.description?.trim() || undefined,
          approverId,
          nodes: nodes?.map((n) => ({ mode: n.mode! as 'single' | 'all' | 'any', approverIds: n.approverIds! })),
          createdBy: userId,
        })
        const { message } = await createMessage(pool, {
          sessionId,
          senderId: userId,
          senderKind: 'human',
          contentType: 'confirmation_card',
          content: `待审批：${approval.title}`,
          clientMsgId: `approval-card-${approval.id}`,
          ref: { kind: 'approval', id: approval.id },
        })
        emitMessageCreated(message)
        return reply.code(201).send({ approval, cardMessage: message })
      } catch (err) {
        if (err instanceof ApprovalStateError && err.code === 'AGENT_NOT_ALLOWED') {
          return reply.code(400).send({ error: err.message })
        }
        console.error('[approval] create failed, compensating:', err)
        if (err instanceof ApprovalStateError && err.code !== 'AGENT_NOT_ALLOWED') throw err
        throw err
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/v1/approvals/:id',
    { preHandler: auth },
    async (request, reply) => {
      const approvalId = request.params.id
      if (!UUID_PATTERN.test(approvalId)) {
        return reply.code(400).send({ error: 'approval id must be a uuid' })
      }
      const approval = await getApproval(pool, approvalId)
      if (!approval) return reply.code(404).send({ error: 'approval not found' })
      if (!(await isMember(pool, approval.sessionId, request.user!.id))) {
        return reply.code(403).send({ error: 'not a member of the approval session' })
      }
      return { approval }
    },
  )

  app.post<{ Params: { id: string }; Body: { decision?: string; reason?: string } }>(
    '/api/v1/approvals/:id/decide',
    { preHandler: auth },
    async (request, reply) => {
      const approvalId = request.params.id
      if (!UUID_PATTERN.test(approvalId)) {
        return reply.code(400).send({ error: 'approval id must be a uuid' })
      }
      const userId = request.user!.id
      const decision = request.body?.decision
      if (decision !== 'approved' && decision !== 'rejected') {
        return reply.code(400).send({ error: 'decision must be approved|rejected' })
      }
      try {
        const approval = await decideApproval(pool, {
          id: approvalId,
          approverId: userId,
          decision,
          reason: request.body?.reason?.trim() || undefined,
        })
        await updateCard(pool, approvalId, approval.status, approval.reason, approval.title, emitMessageUpdated)
        void recordAudit(pool, {
          actorId: userId,
          action: 'approval.decided',
          target: approval.id,
          detail: { decision: approval.status, title: approval.title, currentNodeIndex: approval.currentNodeIndex },
        }).catch((err) => console.error('[audit] decision record failed:', err))
        return { approval }
      } catch (err) {
        if (err instanceof ApprovalStateError) {
          const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'AGENT_NOT_ALLOWED' ? 400 : 409
          return reply.code(status).send({ error: err.message })
        }
        throw err
      }
    },
  )

  app.post<{ Params: { id: string }; Body: { newApproverId?: string } }>(
    '/api/v1/approvals/:id/transfer',
    { preHandler: auth },
    async (request, reply) => {
      const approvalId = request.params.id
      if (!UUID_PATTERN.test(approvalId)) {
        return reply.code(400).send({ error: 'approval id must be a uuid' })
      }
      const newApproverId = request.body?.newApproverId?.trim()
      if (!newApproverId) {
        return reply.code(400).send({ error: 'newApproverId is required' })
      }
      try {
        const approval = await transferApproval(pool, { id: approvalId, operatorId: request.user!.id, newApproverId })
        void recordAudit(pool, {
          actorId: request.user!.id,
          action: 'approval.transferred',
          target: approval.id,
          detail: { newApproverId, title: approval.title },
        }).catch((err) => console.error('[audit] transfer record failed:', err))
        return { approval }
      } catch (err) {
        if (err instanceof ApprovalStateError) {
          const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'AGENT_NOT_ALLOWED' ? 400 : 409
          return reply.code(status).send({ error: err.message })
        }
        throw err
      }
    },
  )

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/v1/approvals/:id/return',
    { preHandler: auth },
    async (request, reply) => {
      const approvalId = request.params.id
      if (!UUID_PATTERN.test(approvalId)) {
        return reply.code(400).send({ error: 'approval id must be a uuid' })
      }
      const reason = request.body?.reason?.trim()
      if (!reason) {
        return reply.code(400).send({ error: 'reason is required for return' })
      }
      try {
        const approval = await returnApproval(pool, { id: approvalId, operatorId: request.user!.id, reason })
        await updateCard(pool, approvalId, approval.status, approval.reason, approval.title, emitMessageUpdated)
        void recordAudit(pool, {
          actorId: request.user!.id,
          action: 'approval.returned',
          target: approval.id,
          detail: { reason, title: approval.title },
        }).catch((err) => console.error('[audit] return record failed:', err))
        return { approval }
      } catch (err) {
        if (err instanceof ApprovalStateError) {
          const status = err.code === 'NOT_FOUND' ? 404 : 409
          return reply.code(status).send({ error: err.message })
        }
        throw err
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/v1/approvals/:id/resubmit',
    { preHandler: auth },
    async (request, reply) => {
      const approvalId = request.params.id
      if (!UUID_PATTERN.test(approvalId)) {
        return reply.code(400).send({ error: 'approval id must be a uuid' })
      }
      try {
        const approval = await resubmitApproval(pool, { id: approvalId, operatorId: request.user!.id })
        await updateCard(pool, approvalId, approval.status, undefined, approval.title, emitMessageUpdated)
        void recordAudit(pool, {
          actorId: request.user!.id,
          action: 'approval.resubmitted',
          target: approval.id,
          detail: { version: approval.version, title: approval.title },
        }).catch((err) => console.error('[audit] resubmit record failed:', err))
        return { approval }
      } catch (err) {
        if (err instanceof ApprovalStateError) {
          const status = err.code === 'NOT_FOUND' ? 404 : 409
          return reply.code(status).send({ error: err.message })
        }
        throw err
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/v1/approvals/:id/cancel',
    { preHandler: auth },
    async (request, reply) => {
      const approvalId = request.params.id
      if (!UUID_PATTERN.test(approvalId)) {
        return reply.code(400).send({ error: 'approval id must be a uuid' })
      }
      try {
        const approval = await cancelApproval(pool, { id: approvalId, operatorId: request.user!.id })
        await updateCard(pool, approvalId, approval.status, undefined, approval.title, emitMessageUpdated)
        void recordAudit(pool, {
          actorId: request.user!.id,
          action: 'approval.cancelled',
          target: approval.id,
          detail: { title: approval.title },
        }).catch((err) => console.error('[audit] cancel record failed:', err))
        return { approval }
      } catch (err) {
        if (err instanceof ApprovalStateError) {
          const status = err.code === 'NOT_FOUND' ? 404 : 409
          return reply.code(status).send({ error: err.message })
        }
        throw err
      }
    },
  )
}

async function updateCard(
  pool: pg.Pool,
  approvalId: string,
  status: string,
  reason: string | undefined,
  title: string,
  emitMessageUpdated: (message: Message) => void,
): Promise<void> {
  const cardId = await findCardMessageId(pool, approvalId)
  if (!cardId) return
  const suffix = reason ? `（${reason}）` : ''
  const prefix =
    status === 'approved' ? '✅ 已通过' : status === 'rejected' ? '❌ 已驳回' : status === 'returned' ? '↩️ 已退回修改' : status === 'cancelled' ? '⛔ 已撤销' : '待审批'
  const updated = await updateMessageContent(pool, cardId, `${prefix}：${title}${suffix}`)
  if (updated) emitMessageUpdated(updated)
}

async function findCardMessageId(pool: pg.Pool, approvalId: string): Promise<string | null> {
  const res = await pool.query<{ id: string }>(
    'SELECT id FROM messages WHERE ref_kind = $1 AND ref_id = $2 ORDER BY seq ASC LIMIT 1',
    ['approval', approvalId],
  )
  return res.rows[0]?.id ?? null
}
```

> 注：`isApprovalNodeMode` 类型守卫已在 Task 1 的契约代码块中包含（ApprovalNodeMode 定义之后），无需再追加；直接 import 使用即可。

- [ ] **Step 2: 扩展路由测试**

读 `services/gateway/src/routes/approvals.test.ts`（先读确认 setup：buildApp/登录/建会话 helper），追加：

```ts
  it('creates a multi-node approval and advances via decide', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: {
        title: '两级审批',
        nodes: [
          { mode: 'single', approverIds: ['u-bob'] },
          { mode: 'single', approverIds: ['u-carol'] },
        ],
      },
    })
    expect(res.statusCode).toBe(201)
    const { approval } = res.json()
    expect(approval.nodes).toHaveLength(2)
    expect(approval.currentNodeIndex).toBe(0)

    const bob = await loginAs('bob')
    const first = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approval.id}/decide`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { decision: 'approved' },
    })
    expect(first.statusCode).toBe(200)
    expect(first.json().approval.currentNodeIndex).toBe(1)

    const carol = await loginAs('carol')
    const second = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approval.id}/decide`,
      headers: { authorization: `Bearer ${carol}` },
      payload: { decision: 'approved' },
    })
    expect(second.statusCode).toBe(200)
    expect(second.json().approval.status).toBe('approved')
  })

  it('rejects agent approvers with 400', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: {
        title: 'agent 审批',
        nodes: [{ mode: 'single', approverIds: ['agent-ta-pm'] }],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('transfers the approval to another approver', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '转办', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    const bob = await loginAs('bob')
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/transfer`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { newApproverId: 'u-carol' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().approval.nodes[0].approverIds).toEqual(['u-carol'])
  })

  it('returns for revision and resubmits', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '驳回修改', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    const bob = await loginAs('bob')
    const returned = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/return`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { reason: '请补充预算' },
    })
    expect(returned.statusCode).toBe(200)
    expect(returned.json().approval.status).toBe('returned')

    const resubmitted = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/resubmit`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(resubmitted.statusCode).toBe(200)
    expect(resubmitted.json().approval.version).toBe(2)
    expect(resubmitted.json().approval.status).toBe('pending')
  })

  it('cancels only by the creator', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '撤销', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    const bob = await loginAs('bob')
    const denied = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/cancel`,
      headers: { authorization: `Bearer ${bob}` },
    })
    expect(denied.statusCode).toBe(409)
    const cancelled = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/cancel`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(cancelled.statusCode).toBe(200)
    expect(cancelled.json().approval.status).toBe('cancelled')
  })
```

（loginAs/createProjectSession 用既有测试的 helper 名——先读文件确认；既有 helper 可能仅 alice/bob 存在，carol 需 loginAs('carol') 自动创建，核对 users repo 的演示登录逻辑。）

- [ ] **Step 3: 跑路由测试**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose src/routes/approvals.test.ts src/repos/approvals.test.ts
```

Expected: typecheck exit 0；路由既有 7 用例 + 新增 5 = 12、仓储 16 全 PASS。

- [ ] **Step 4: 提交**

```bash
git add packages/contracts services/gateway/src/routes/approvals.ts services/gateway/src/routes/approvals.test.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(approval): 多级审批路由（nodes 创建/转办/退回重提/撤销 + 人类校验）"
```

---

## Task 4: 前端审批卡片（节点进度 + 操作）

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/Chat.tsx`
- Modify: `apps/web/src/pages/Chat.test.tsx`

- [ ] **Step 1: client.ts 增 API**

读 `apps/web/src/api/client.ts`，在 `decideApproval` 附近追加：

```ts
export const transferApproval = (approvalId: string, newApproverId: string): Promise<{ approval: Approval }> =>
  request(`/api/v1/approvals/${approvalId}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ newApproverId }),
  })

export const returnApproval = (approvalId: string, reason: string): Promise<{ approval: Approval }> =>
  request(`/api/v1/approvals/${approvalId}/return`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })

export const resubmitApproval = (approvalId: string): Promise<{ approval: Approval }> =>
  request(`/api/v1/approvals/${approvalId}/resubmit`, { method: 'POST' })

export const cancelApproval = (approvalId: string): Promise<{ approval: Approval }> =>
  request(`/api/v1/approvals/${approvalId}/cancel`, { method: 'POST' })
```

（核对现有 `request` 签名与 `decideApproval` 写法后对齐——可能 request 已带 method/body 支持。）

- [ ] **Step 2: Chat.tsx 卡片渲染与操作**

读 `apps/web/src/pages/Chat.tsx`（重点：decide 函数 ~:181、卡片渲染 ~:395-420、members 状态），修改：

1. import 增：`cancelApproval, resubmitApproval, returnApproval, transferApproval`。

2. 现有 `decide` 函数保留；其后追加操作函数：

```tsx
  async function approvalAction(message: Message, action: 'transfer' | 'return' | 'resubmit' | 'cancel', extra?: string) {
    if (!message.ref || message.ref.kind !== 'approval') return
    setError(null)
    try {
      let approval: Approval | null = null
      if (action === 'transfer' && extra) approval = (await transferApproval(message.ref.id, extra)).approval
      else if (action === 'return' && extra) approval = (await returnApproval(message.ref.id, extra)).approval
      else if (action === 'resubmit') approval = (await resubmitApproval(message.ref.id)).approval
      else if (action === 'cancel') approval = (await cancelApproval(message.ref.id)).approval
      if (!approval) return
      // 更新本地卡片内容
      const title = message.content.replace(/^(待审批|✅ 已通过|❌ 已驳回|↩️ 已退回修改|⛔ 已撤销)：/, '')
      const prefix = approval.status === 'approved' ? '✅ 已通过' : approval.status === 'rejected' ? '❌ 已驳回' : approval.status === 'returned' ? '↩️ 已退回修改' : approval.status === 'cancelled' ? '⛔ 已撤销' : '待审批'
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, content: `${prefix}：${title}` } : m)))
      await loadMessages(activeId!)
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
  }
```

3. 卡片渲染：把 `isPending` 判定区（~:395）与操作区（~:411-414）替换为（在既有 approval-card 内渲染节点进度 + 操作）：

```tsx
                  <div className="approval-card">
                    <div className="approval-title">{m.content}</div>
                    {m.ref?.kind === 'approval' && isPending ? (
                      <>
                        <div className="approval-nodes">
                          {m.approval?.nodes?.map((n) => (
                            <span key={n.index} className={`approval-node ${n.index === m.approval?.currentNodeIndex ? 'active' : ''} ${n.status !== 'pending' ? n.status : ''}`}>
                              {n.mode === 'all' ? '会签' : n.mode === 'any' ? '或签' : '单人'}·{n.approverIds.join('/')}·{n.status === 'approved' ? '✅' : n.status === 'rejected' ? '❌' : '⏳'}
                            </span>
                          ))}
                          {m.approval && m.approval.nodes.length > 0 ? <span className="approval-version">v{m.approval.version}</span> : null}
                        </div>
                        <div className="approval-actions">
                          <button className="approve" onClick={() => void decide(m, 'approved')}>通过</button>
                          <button className="reject" onClick={() => void decide(m, 'rejected')}>驳回</button>
                          <button className="ghost small" onClick={() => void handleTransfer(m)}>转办</button>
                          <button className="ghost small" onClick={() => void handleReturn(m)}>修改意见</button>
                        </div>
                      </>
                    ) : null}
                    {m.ref?.kind === 'approval' && m.approval?.status === 'returned' ? (
                      <div className="approval-actions">
                        <button className="approve" onClick={() => void approvalAction(m, 'resubmit')}>重新提交</button>
                        <button className="ghost small" onClick={() => void approvalAction(m, 'cancel')}>撤销</button>
                      </div>
                    ) : null}
                    {m.ref?.kind === 'approval' && isPending && m.approval?.status === 'pending' ? (
                      <div className="approval-actions">
                        <button className="ghost small" onClick={() => void approvalAction(m, 'cancel')}>撤销</button>
                      </div>
                    ) : null}
                  </div>
```

> 注：需要 `Approval` 类型 import（Chat.tsx 现有 import 若已含则跳过）；`m.approval` 是消息上附加的审批数据——**契约 `Message` 无 approval 字段**，本方案在 Task 3 已新增 `GET /api/v1/approvals/:id` 详情端点（返回 `{ approval }`，isMember 校验），前端 loadMessages 后对有 ref approval 的消息并行 fetch 详情挂到本地 state（`approvalById: Record<string, Approval>`）。完整方案如下：

4. 补 GET 详情路由（后端，若 Task 3 未含）：在 routes/approvals.ts 增：

```ts
  app.get<{ Params: { id: string } }>(
    '/api/v1/approvals/:id',
    { preHandler: auth },
    async (request, reply) => {
      const approvalId = request.params.id
      if (!UUID_PATTERN.test(approvalId)) {
        return reply.code(400).send({ error: 'approval id must be a uuid' })
      }
      const approval = await getApproval(pool, approvalId)
      if (!approval) return reply.code(404).send({ error: 'approval not found' })
      if (!(await isMember(pool, approval.sessionId, request.user!.id))) {
        return reply.code(403).send({ error: 'not a member of the approval session' })
      }
      return { approval }
    },
  )
```

（import 增 getApproval；getApproval 现返回带 nodes 的完整结构。）

4. 前端：Chat.tsx 增 `const [approvalById, setApprovalById] = useState<Record<string, Approval>>({})`；`loadMessages` 内对 `ref.kind === 'approval'` 的消息并行 `getApproval(m.ref.id)`（client.ts 增 `export const getApproval = (id: string): Promise<{ approval: Approval }> => request(`/api/v1/approvals/${id}`)`）并 setApprovalById；渲染用 `approvalById[m.ref.id]`。操作函数 handleTransfer/handleReturn 用 window.prompt：

```tsx
  function handleTransfer(message: Message) {
    const target = window.prompt('转办给（用户 id）')
    if (target?.trim()) void approvalAction(message, 'transfer', target.trim())
  }
  function handleReturn(message: Message) {
    const reason = window.prompt('修改意见')
    if (reason?.trim()) void approvalAction(message, 'return', reason.trim())
  }
```

> 注 3：prompt 在 jsdom 测试需 stub（`vi.spyOn(window, 'prompt').mockReturnValue('u-carol')`）。若你倾向更干净的选人 UI，可复用 members 列表渲染内联选择器——但为控制本计划范围，用 prompt + 记决策记录（Phase 2 后续做选人弹层）。

- [ ] **Step 3: Chat.test.tsx 补用例**

读 `apps/web/src/pages/Chat.test.tsx`，追加（mock 含审批卡片的会话；getApproval/transfer 走 mockFetch；prompt stub）：

```tsx
  it('renders approval node progress and can transfer', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('u-carol')
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': {
        messages: [
          { id: 'm1', clientMsgId: 'c1', sessionId: 's1', senderId: 'u-alice', senderKind: 'human', contentType: 'confirmation_card', content: '待审批：两级审批', seq: 1, createdAt: '', ref: { kind: 'approval', id: 'a1' } },
        ],
      },
      '/api/v1/approvals/a1': { approval: { id: 'a1', sessionId: 's1', title: '两级审批', status: 'pending', approverId: 'u-bob', createdBy: 'u-alice', createdAt: '', mode: 'single', currentNodeIndex: 0, version: 1, nodes: [{ index: 0, mode: 'single', approverIds: ['u-bob'], status: 'pending' }] } },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [{ userId: 'u-bob', name: 'bob', kind: 'human' }] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText(/单人·u-bob·⏳/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /转办/ })).toBeTruthy()
  })
```

（若 mockFetch 对 `GET /api/v1/approvals/a1` 的 key 形式与现有实现不一致，按现有 mockFetch 的 URL-only 风格写 key。`FakeWebSocket` 沿用既有。）

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose src/pages/Chat.test.tsx
pnpm --filter @ta/web build
```

Expected: 全 exit 0；Chat.test.tsx 14 用例全 PASS（13 + 1 新增）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/api/client.ts apps/web/src/pages/Chat.tsx apps/web/src/pages/Chat.test.tsx services/gateway/src/routes/approvals.ts services/gateway/src/routes/approvals.test.ts packages/contracts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(approval): 前端多级卡片（节点进度 + 转办/退回重提/撤销）"
```

---

## Task 5: README + 全仓验收 + 推送 + 真实验收

- [x] **Step 1: README 追加「多级审批」节**

在 README「### 审批卡片」节（若有）或「### 任务看板」前追加：

```markdown
### 多级审批（FR-APP-02）

审批流支持串行多节点（单人/会签 all/或签 any）：会签需全部审批人通过、任一驳回整体拒绝；或签任一通过即过。支持转办（当前节点审批人换人，audit 留痕）、驳回修改（↩️ 退回 → 发起人修订后重新提交，版本 +1）、发起人撤销。审批人必须是人类（agent 提交审批返回 400）。

```bash
# 创建两级审批（第一节点单人 → 第二节点会签）
curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/approvals \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"两级审批","nodes":[{"mode":"single","approverIds":["u-bob"]},{"mode":"all","approverIds":["u-carol","u-dave"]}]}'
# 当前节点审批：POST /api/v1/approvals/<id>/decide {decision}
# 转办：POST /api/v1/approvals/<id>/transfer {newApproverId}
# 退回修改：POST /api/v1/approvals/<id>/return {reason}；发起人重提：POST /api/v1/approvals/<id>/resubmit
# 撤销（发起人）：POST /api/v1/approvals/<id>/cancel
```
```

- [x] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
```

Expected: build 全过；test 全绿（contracts 2 + gateway 137+14≈151 + web 27+1≈28 ≈ 181）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净（除 README/计划文档）。

- [x] **Step 3: 真实验收（多级串行 + 会签 + 转办）**

```bash
cd /tmp
# 1) 启动 gateway（NODE_ENV=development + MODEL_API_KEY）
# 2) 登录建会话 → 创建两级审批（single u-bob → all u-carol,u-dave）
# 3) u-bob 通过 → currentNodeIndex=1
# 4) u-carol 通过 → 仍 pending（会签未齐）；u-carol 再投 → ALREADY_DECIDED 409
# 5) u-dave 驳回 → 整体 rejected
# 6) 新建审批 → 转办给 u-dave → u-dave 通过 → approved
# 7) 新建审批 → u-bob 退回修改 → returned；发起人 resubmit → version 2 pending
```

Expected: 每步状态与 PRD 一致；audit 事件（approval.decided/transferred/returned/resubmitted/cancelled）落库。

- [x] **Step 4: 提交 + 推送**

```bash
git add README.md docs/superpowers/plans/2026-08-15-phase2-plan1-multi-level-approval.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 12 全部勾选 + README 多级审批说明"
git push
```

Expected: 推送成功。

---

## Self-Review 记录

- **Spec 覆盖**：FR-APP-02（多级/会签 all/或签 any/单人/串行组合/转办/驳回修改/版本+1）→ Task 2 状态机 + Task 3 路由 + Task 4 前端；FR-APP-05（撤销）→ cancelApproval；PR-1（人类审批闸门、agent 拒绝）→ assertHumanApprovers + 路由 AGENT_NOT_ALLOWED→400；PRD 场景四（业务负责人+技术负责人两级串行）→ Task 5 真实验收第 2-5 步；「与卡片/待办/看板状态强一致」→ 卡片内容 updateCard 广播 message.updated。FR-APP-04（待办中心）/FR-APP-06（超时升级）→ 记入后续计划（决策记录）。
- **占位符扫描**：无 TBD；代码逐字给出。
- **类型一致性**：`ApprovalNode`（index/mode/approverIds/status/decidedBy/reason/decidedAt）在契约/repo map/路由/前端一致；`Approval` 新增字段（mode/currentNodeIndex/version/nodes）全链路一致；`ApprovalStatus` 五态全链路一致；`mapApproval(row, nodes)` 新签名在 repo 内部调用一致（路由不直接 map）。`isApprovalNodeMode` 守卫在契约定义、路由使用一致。
- **已知取舍**：转办/退回修改前端用 window.prompt（MVP，选人弹层记 Phase 2 后续）；会签 votes JSONB 一人一票（重复裁决 409）；RETURNED 重提全流程重置（版本+1，非断点续审——断点续审记后续）；GET /api/v1/approvals/:id 为前端节点进度新增；超时升级/待办中心/可视化配置（P2）记后续计划。
