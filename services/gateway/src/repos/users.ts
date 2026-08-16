import pg from 'pg'
import type { OrgMember } from '@ta/contracts'

export type UserRole = 'admin' | 'member'

export class AdminLockoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdminLockoutError'
  }
}

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
  // 最后 admin 保护（T2 质量审查 M1）：降级最后一个 admin 会导致组织永久失去管理能力
  if (role !== 'admin') {
    const target = await pool.query<{ role: string }>('SELECT role FROM users WHERE user_id = $1', [userId])
    if (target.rows[0]?.role === 'admin') {
      const admins = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE role = 'admin'")
      if (admins.rows[0]!.n <= 1) {
        throw new AdminLockoutError('cannot demote the last admin')
      }
    }
  }
  const res = await pool.query<UserRow>(
    `UPDATE users SET role = $2 WHERE user_id = $1 RETURNING *`,
    [userId, role],
  )
  return res.rows[0] ? mapUser(res.rows[0]) : null
}
