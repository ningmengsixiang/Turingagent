import pg from 'pg'
import type { FileInfo } from '@ta/contracts'

export interface FileRow {
  id: string
  session_id: string
  name: string
  size: string
  mime: string
  storage_key: string
  uploaded_by: string
  created_at: Date
}

export function mapFile(row: FileRow): FileInfo {
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    size: Number(row.size),
    mime: row.mime,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at.toISOString(),
  }
}

export async function createFile(
  pool: pg.Pool,
  input: { sessionId: string; name: string; size: number; mime: string; storageKey: string; uploadedBy: string },
): Promise<FileInfo> {
  const res = await pool.query<FileRow>(
    `INSERT INTO files (session_id, name, size, mime, storage_key, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.sessionId, input.name, input.size, input.mime, input.storageKey, input.uploadedBy],
  )
  return mapFile(res.rows[0]!)
}

export async function getFile(pool: pg.Pool, id: string): Promise<FileInfo | null> {
  const res = await pool.query<FileRow>('SELECT * FROM files WHERE id = $1', [id])
  return res.rows[0] ? mapFile(res.rows[0]) : null
}

export async function listFilesForSession(pool: pg.Pool, sessionId: string): Promise<FileInfo[]> {
  const res = await pool.query<FileRow>('SELECT * FROM files WHERE session_id = $1 ORDER BY created_at DESC', [sessionId])
  return res.rows.map(mapFile)
}
