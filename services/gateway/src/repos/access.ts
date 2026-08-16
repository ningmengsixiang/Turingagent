import pg from 'pg'

export interface AccessUser {
  role: string
  department_id: string | null
  tenant_id: string | null
}

export interface AccessSession {
  department_id: string | null
  tenant_id: string | null
}

/** ABAC 行级访问：admin 本租户全可见；会话成员可见；同部门项目会话可见；跨租户一律不可见（前置租户隔离 FR-SEC-02） */
export async function canAccessSession(
  pool: pg.Pool,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const user = await pool.query<AccessUser>(
    'SELECT role, department_id, tenant_id FROM users WHERE user_id = $1',
    [userId],
  )
  if (user.rows.length === 0) return false
  // 会话归属（租户 + 部门）一次查询（M2 写放大修复延续）
  const session = await pool.query<AccessSession>(
    'SELECT department_id, tenant_id FROM sessions WHERE id = $1',
    [sessionId],
  )
  const s = session.rows[0]
  if (!s) return false
  // 前置租户匹配：会话租户 ≠ 用户租户 → 跨租户不可见（双方均有租户时才判；无租户历史数据退化为旧逻辑）
  if (user.rows[0]!.tenant_id && s.tenant_id && user.rows[0]!.tenant_id !== s.tenant_id) return false

  if (user.rows[0]!.role === 'admin') return true

  // 会话成员（RBAC 成员语义）
  const member = await pool.query<{ session_id: string }>(
    'SELECT session_id FROM session_members WHERE session_id = $1 AND user_id = $2',
    [sessionId, userId],
  )
  if (member.rows.length > 0) return true

  // 同部门项目会话（ABAC 属性规则）
  if (s.department_id && user.rows[0]!.department_id === s.department_id) return true
  return false
}

/** 可见会话 id 集（admin 本租户全部 + 成员 + 同部门项目，均限本租户） */
export async function listVisibleSessionIds(pool: pg.Pool, userId: string): Promise<string[]> {
  const user = await pool.query<AccessUser>(
    'SELECT role, department_id, tenant_id FROM users WHERE user_id = $1',
    [userId],
  )
  if (user.rows.length === 0) return []
  const tenantId = user.rows[0]!.tenant_id
  if (user.rows[0]!.role === 'admin') {
    // admin 只列本租户会话（admin 是操作权限非数据越权）
    const all = tenantId
      ? await pool.query<{ id: string }>('SELECT id FROM sessions WHERE tenant_id = $1', [tenantId])
      : await pool.query<{ id: string }>('SELECT id FROM sessions')
    return all.rows.map((r) => r.id)
  }
  // 成员会话：JOIN sessions 过滤会话租户 == 用户租户（无租户用户退化：不过滤，维持旧行为）
  const member = tenantId
    ? await pool.query<{ session_id: string }>(
        `SELECT sm.session_id FROM session_members sm
           JOIN sessions s ON s.id = sm.session_id
          WHERE sm.user_id = $1 AND s.tenant_id = $2`,
        [userId, tenantId],
      )
    : await pool.query<{ session_id: string }>(
        'SELECT session_id FROM session_members WHERE user_id = $1',
        [userId],
      )
  const ids = new Set(member.rows.map((r) => r.session_id))
  if (user.rows[0]!.department_id) {
    // 同部门项目会话：同样限本租户
    const dept = tenantId
      ? await pool.query<{ id: string }>(
          'SELECT id FROM sessions WHERE department_id = $1 AND tenant_id = $2',
          [user.rows[0]!.department_id, tenantId],
        )
      : await pool.query<{ id: string }>(
          'SELECT id FROM sessions WHERE department_id = $1',
          [user.rows[0]!.department_id],
        )
    for (const r of dept.rows) ids.add(r.id)
  }
  return [...ids]
}
