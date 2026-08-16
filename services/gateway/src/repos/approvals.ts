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

/** 节点 + 内部投票（votes 仅仓储层聚合使用，契约 ApprovalNode 不含该字段） */
type ApprovalNodeWithVotes = ApprovalNode & { votes: Record<string, string> }

async function loadNodes(pool: pg.Pool, approvalId: string): Promise<ApprovalNodeWithVotes[]> {
  const res = await pool.query<ApprovalNodeRow>(
    'SELECT * FROM approval_nodes WHERE approval_id = $1 ORDER BY node_index ASC',
    [approvalId],
  )
  return res.rows.map((row) => ({ ...mapApprovalNode(row), votes: row.votes }))
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
