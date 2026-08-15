import pg from 'pg'
import type { Session } from '@ta/contracts'

export interface SessionWithUnread extends Session {
  unreadCount: number
}

export interface SessionRow {
  id: string
  kind: 'direct' | 'project' | 'group'
  title: string
  last_seq: string
  created_at: Date
}

function mapSession(row: SessionRow): Session {
  return { id: row.id, kind: row.kind, title: row.title, memberIds: [] }
}

export async function createSession(
  pool: pg.Pool,
  input: { kind: 'direct' | 'project' | 'group'; title: string; memberIds: string[] },
): Promise<Session> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const res = await client.query<SessionRow>(
      'INSERT INTO sessions (kind, title) VALUES ($1, $2) RETURNING *',
      [input.kind, input.title],
    )
    const session = mapSession(res.rows[0]!)
    const members = [...new Set([...input.memberIds])]
    for (const userId of members) {
      await client.query('INSERT INTO session_members (session_id, user_id) VALUES ($1, $2)', [
        session.id,
        userId,
      ])
    }
    await client.query('COMMIT')
    return { ...session, memberIds: members }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function listSessionsForUser(pool: pg.Pool, userId: string): Promise<SessionWithUnread[]> {
  const res = await pool.query<{
    id: string
    kind: 'direct' | 'project' | 'group'
    title: string
    unread: string
  }>(
    `SELECT s.id, s.kind, s.title,
            (SELECT count(*) FROM messages m
              WHERE m.session_id = s.id
                AND m.seq > sm.last_read_seq
                AND m.sender_id <> $1)::text AS unread
       FROM session_members sm
       JOIN sessions s ON s.id = sm.session_id
      WHERE sm.user_id = $1
      ORDER BY s.created_at DESC`,
    [userId],
  )
  return res.rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    memberIds: [],
    unreadCount: Number(r.unread),
  }))
}

export async function isMember(pool: pg.Pool, sessionId: string, userId: string): Promise<boolean> {
  const res = await pool.query('SELECT 1 FROM session_members WHERE session_id = $1 AND user_id = $2', [
    sessionId,
    userId,
  ])
  return res.rowCount !== null && res.rowCount > 0
}

export async function getSessionById(pool: pg.Pool, sessionId: string): Promise<Session | null> {
  const res = await pool.query<SessionRow>('SELECT * FROM sessions WHERE id = $1', [sessionId])
  if (!res.rows[0]) return null
  return mapSession(res.rows[0])
}

export async function listSessionIdsForUser(pool: pg.Pool, userId: string): Promise<string[]> {
  const res = await pool.query('SELECT session_id FROM session_members WHERE user_id = $1', [userId])
  return res.rows.map((r) => r.session_id as string)
}

export async function markRead(
  pool: pg.Pool,
  sessionId: string,
  userId: string,
  seq: number,
): Promise<void> {
  await pool.query(
    `UPDATE session_members SET last_read_seq = GREATEST(last_read_seq, $3)
      WHERE session_id = $1 AND user_id = $2`,
    [sessionId, userId, seq],
  )
}
