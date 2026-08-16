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
