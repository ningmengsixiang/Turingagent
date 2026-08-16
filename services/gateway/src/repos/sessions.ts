import pg from 'pg'
import type { Session, SessionMember } from '@ta/contracts'
import { AGENTS } from '../agent/registry.js'
import { listVisibleSessionIds } from './access.js'

export interface SessionWithUnread extends Session {
  unreadCount: number
}

export interface SessionRow {
  id: string
  kind: 'direct' | 'project' | 'group'
  title: string
  last_seq: string
  created_at: Date
  tenant_id: string | null
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    memberIds: [],
    tenantId: row.tenant_id ?? undefined,
  }
}

export async function createSession(
  pool: pg.Pool,
  input: { kind: 'direct' | 'project' | 'group'; title: string; memberIds: string[]; tenantId?: string },
): Promise<Session> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const res = await client.query<SessionRow>(
      'INSERT INTO sessions (kind, title, tenant_id) VALUES ($1, $2, $3) RETURNING *',
      [input.kind, input.title, input.tenantId ?? null],
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

/** ABAC 可见性过滤版列表：listVisibleSessionIds（admin 全部 + 成员 + 同部门项目）+ unread 计数 */
export async function listSessionsVisible(pool: pg.Pool, userId: string): Promise<SessionWithUnread[]> {
  const visible = await listVisibleSessionIds(pool, userId)
  if (visible.length === 0) return []
  const res = await pool.query<{
    id: string
    kind: 'direct' | 'project' | 'group'
    title: string
    unread: string
  }>(
    `SELECT s.id, s.kind, s.title,
            (SELECT count(*) FROM messages m
              WHERE m.session_id = s.id
                AND m.seq > COALESCE((SELECT last_read_seq FROM session_members
                                       WHERE session_id = s.id AND user_id = $1), 0)
                AND m.sender_id <> $1)::text AS unread
       FROM sessions s
      WHERE s.id = ANY($2::uuid[])
      ORDER BY s.created_at DESC`,
    [userId, visible],
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

export interface SessionMemberRow {
  user_id: string
  name: string | null
}

export async function listSessionMembers(pool: pg.Pool, sessionId: string): Promise<SessionMember[]> {
  const res = await pool.query<SessionMemberRow>(
    `SELECT sm.user_id, u.name
       FROM session_members sm
       LEFT JOIN users u ON u.user_id = sm.user_id
      WHERE sm.session_id = $1
      ORDER BY sm.joined_at ASC`,
    [sessionId],
  )
  const members: SessionMember[] = res.rows.map((r) => ({
    userId: r.user_id,
    name: r.name ?? r.user_id, // 未注册用户直接展示 id
    kind: 'human',
  }))
  // 固定附加四智能体成员
  for (const agent of AGENTS) {
    members.push({ userId: agent.id, name: agent.displayName, kind: 'agent' })
  }
  return members
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
