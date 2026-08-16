import pg from 'pg'
import type { Approval, ApprovalStatus } from '@ta/contracts'

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
}

export function mapApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    description: row.description || undefined,
    status: row.status as ApprovalStatus,
    approverId: row.approver_id,
    createdBy: row.created_by,
    reason: row.reason ?? undefined,
    createdAt: row.created_at.toISOString(),
    decidedAt: row.decided_at?.toISOString(),
  }
}

export class ApprovalStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApprovalStateError'
  }
}

export async function createApproval(
  pool: pg.Pool,
  input: { sessionId: string; title: string; description?: string; approverId: string; createdBy: string },
): Promise<Approval> {
  const res = await pool.query<ApprovalRow>(
    `INSERT INTO approvals (session_id, title, description, approver_id, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.sessionId, input.title, input.description ?? '', input.approverId, input.createdBy],
  )
  return mapApproval(res.rows[0]!)
}

export async function getApproval(pool: pg.Pool, id: string): Promise<Approval | null> {
  const res = await pool.query<ApprovalRow>('SELECT * FROM approvals WHERE id = $1', [id])
  return res.rows[0] ? mapApproval(res.rows[0]) : null
}

export async function decideApproval(
  pool: pg.Pool,
  input: { id: string; approverId: string; decision: 'approved' | 'rejected'; reason?: string },
): Promise<Approval> {
  const current = await getApproval(pool, input.id)
  if (!current) throw new ApprovalStateError('approval not found')
  if (current.status !== 'pending') throw new ApprovalStateError(`approval already ${current.status}`)
  if (current.approverId !== input.approverId) {
    throw new ApprovalStateError('only the approver can decide')
  }
  const res = await pool.query<ApprovalRow>(
    `UPDATE approvals
        SET status = $2, reason = $3, decided_at = now()
      WHERE id = $1 RETURNING *`,
    [input.id, input.decision, input.reason ?? null],
  )
  return mapApproval(res.rows[0]!)
}
