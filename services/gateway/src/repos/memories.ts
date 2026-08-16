import pg from 'pg'
import type { Memory, MemoryVersion } from '@ta/contracts'

export interface MemoryRow {
  id: string
  session_id: string
  title: string
  content: string
  current_version: number
  created_by: string
  created_at: Date
  updated_at: Date
}

export interface MemoryVersionRow {
  id: string
  memory_id: string
  version: number
  content: string
  edited_by: string
  created_at: Date
}

export function mapMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    content: row.content,
    currentVersion: row.current_version,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export function mapMemoryVersion(row: MemoryVersionRow): MemoryVersion {
  return {
    id: row.id,
    memoryId: row.memory_id,
    version: row.version,
    content: row.content,
    editedBy: row.edited_by,
    createdAt: row.created_at.toISOString(),
  }
}

export type MemoryErrorCode = 'NOT_FOUND'

export class MemoryStateError extends Error {
  readonly code: MemoryErrorCode

  constructor(code: MemoryErrorCode, message: string) {
    super(message)
    this.name = 'MemoryStateError'
    this.code = code
  }
}

export async function createMemory(
  pool: pg.Pool,
  input: { sessionId: string; title: string; content: string; createdBy: string },
): Promise<Memory> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const res = await client.query<MemoryRow>(
      `INSERT INTO memories (session_id, title, content, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.sessionId, input.title, input.content, input.createdBy],
    )
    const memory = res.rows[0]!
    await client.query(
      'INSERT INTO memory_versions (memory_id, version, content, edited_by) VALUES ($1, 1, $2, $3)',
      [memory.id, input.content, input.createdBy],
    )
    await client.query('COMMIT')
    return mapMemory(memory)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getMemory(pool: pg.Pool, id: string): Promise<Memory | null> {
  const res = await pool.query<MemoryRow>('SELECT * FROM memories WHERE id = $1', [id])
  return res.rows[0] ? mapMemory(res.rows[0]) : null
}

export async function listMemoriesForSession(pool: pg.Pool, sessionId: string): Promise<Memory[]> {
  const res = await pool.query<MemoryRow>(
    'SELECT * FROM memories WHERE session_id = $1 ORDER BY updated_at DESC',
    [sessionId],
  )
  return res.rows.map(mapMemory)
}

export async function updateMemoryContent(
  pool: pg.Pool,
  input: { id: string; title?: string; content: string; editedBy: string },
): Promise<Memory> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const cur = await client.query<MemoryRow>('SELECT * FROM memories WHERE id = $1 FOR UPDATE', [input.id])
    if (!cur.rows[0]) throw new MemoryStateError('NOT_FOUND', 'memory not found')
    const nextVersion = cur.rows[0].current_version + 1
    const res = await client.query<MemoryRow>(
      `UPDATE memories
          SET title = COALESCE($2, title), content = $3, current_version = $4, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [input.id, input.title ?? null, input.content, nextVersion],
    )
    await client.query(
      'INSERT INTO memory_versions (memory_id, version, content, edited_by) VALUES ($1, $2, $3, $4)',
      [input.id, nextVersion, input.content, input.editedBy],
    )
    await client.query('COMMIT')
    return mapMemory(res.rows[0]!)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function listMemoryVersions(pool: pg.Pool, memoryId: string): Promise<MemoryVersion[]> {
  const res = await pool.query<MemoryVersionRow>(
    'SELECT * FROM memory_versions WHERE memory_id = $1 ORDER BY version ASC',
    [memoryId],
  )
  return res.rows.map(mapMemoryVersion)
}
