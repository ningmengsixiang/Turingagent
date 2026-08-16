import pg from 'pg'

export interface AccessUser {
  role: string
  department_id: string | null
}

export interface AccessSession {
  department_id: string | null
}

/** ABAC 行级访问：admin 全可见；会话成员可见；同部门项目会话可见 */
export async function canAccessSession(
  pool: pg.Pool,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const user = await pool.query<AccessUser>('SELECT role, department_id FROM users WHERE user_id = $1', [userId])
  if (user.rows.length === 0) return false
  if (user.rows[0]!.role === 'admin') return true

  // 会话成员（RBAC 成员语义）
  const member = await pool.query<{ session_id: string }>(
    'SELECT session_id FROM session_members WHERE session_id = $1 AND user_id = $2',
    [sessionId, userId],
  )
  if (member.rows.length > 0) return true

  // 同部门项目会话（ABAC 属性规则）
  const session = await pool.query<AccessSession>(
    'SELECT department_id FROM sessions WHERE id = $1',
    [sessionId],
  )
  const s = session.rows[0]
  if (!s) return false
  if (s.department_id && user.rows[0]!.department_id === s.department_id) return true
  return false
}

/** 可见会话 id 集（admin 全部 + 成员 + 同部门项目） */
export async function listVisibleSessionIds(pool: pg.Pool, userId: string): Promise<string[]> {
  const user = await pool.query<AccessUser>('SELECT role, department_id FROM users WHERE user_id = $1', [userId])
  if (user.rows.length === 0) return []
  if (user.rows[0]!.role === 'admin') {
    const all = await pool.query<{ id: string }>('SELECT id FROM sessions')
    return all.rows.map((r) => r.id)
  }
  const member = await pool.query<{ session_id: string }>(
    'SELECT session_id FROM session_members WHERE user_id = $1',
    [userId],
  )
  const ids = new Set(member.rows.map((r) => r.session_id))
  if (user.rows[0]!.department_id) {
    const dept = await pool.query<{ id: string }>(
      'SELECT id FROM sessions WHERE department_id = $1',
      [user.rows[0]!.department_id],
    )
    for (const r of dept.rows) ids.add(r.id)
  }
  return [...ids]
}
