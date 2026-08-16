import pg from 'pg'
import type { KbDocument } from '@ta/contracts'

export interface KbRow {
  id: string
  session_id: string
  title: string
  content: string
  created_by: string
  created_at: Date
}

export function mapKb(row: KbRow): KbDocument {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    content: row.content,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  }
}

export async function createKbDocument(
  pool: pg.Pool,
  input: { sessionId: string; title: string; content: string; createdBy: string },
): Promise<KbDocument> {
  const res = await pool.query<KbRow>(
    `INSERT INTO kb_documents (session_id, title, content, created_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.sessionId, input.title, input.content, input.createdBy],
  )
  return mapKb(res.rows[0]!)
}

export async function listKbForSession(pool: pg.Pool, sessionId: string): Promise<KbDocument[]> {
  const res = await pool.query<KbRow>(
    'SELECT * FROM kb_documents WHERE session_id = $1 ORDER BY created_at DESC',
    [sessionId],
  )
  return res.rows.map(mapKb)
}

/** 关键词全文检索（ILIKE，MVP；pg_trgm/全文索引记 Phase 2 后续） */
export async function searchKb(pool: pg.Pool, sessionId: string, q: string): Promise<KbDocument[]> {
  const like = `%${q}%`
  const res = await pool.query<KbRow>(
    `SELECT * FROM kb_documents
      WHERE session_id = $1 AND (title ILIKE $2 OR content ILIKE $2)
      ORDER BY created_at DESC`,
    [sessionId, like],
  )
  return res.rows.map(mapKb)
}
