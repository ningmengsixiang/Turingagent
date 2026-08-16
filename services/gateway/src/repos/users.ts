import pg from 'pg'
import type { OrgMember } from '@ta/contracts'

export type UserRole = 'admin' | 'member'

export interface UserRow {
  user_id: string
  name: string
  role: string
  created_at: Date
}

export function mapUser(row: UserRow): OrgMember {
  return {
    userId: row.user_id,
    name: row.name,
    role: row.role as UserRole,
    createdAt: row.created_at.toISOString(),
  }
}

/** 首次登录即注册（upsert）：全表为空时第一个用户自动成为 admin */
export async function upsertUser(pool: pg.Pool, userId: string, name: string): Promise<OrgMember> {
  await pool.query(
    `INSERT INTO users (user_id, name, role)
     VALUES ($1, $2, CASE WHEN NOT EXISTS (SELECT 1 FROM users) THEN 'admin' ELSE 'member' END)
     ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name`,
    [userId, name],
  )
  const res = await pool.query<UserRow>('SELECT * FROM users WHERE user_id = $1', [userId])
  return mapUser(res.rows[0]!)
}

export async function getUserRole(pool: pg.Pool, userId: string): Promise<UserRole | null> {
  const res = await pool.query<{ role: string }>('SELECT role FROM users WHERE user_id = $1', [userId])
  return res.rows[0] ? (res.rows[0].role as UserRole) : null
}

export async function listMembers(pool: pg.Pool): Promise<OrgMember[]> {
  const res = await pool.query<UserRow>('SELECT * FROM users ORDER BY created_at ASC')
  return res.rows.map(mapUser)
}

export async function setRole(
  pool: pg.Pool,
  userId: string,
  role: UserRole,
): Promise<OrgMember | null> {
  const res = await pool.query<UserRow>(
    `UPDATE users SET role = $2 WHERE user_id = $1 RETURNING *`,
    [userId, role],
  )
  return res.rows[0] ? mapUser(res.rows[0]) : null
}
