import pg from 'pg'
import type { Tenant, TenantStatus } from '@ta/contracts'

export interface TenantRow {
  id: string
  name: string
  status: string
  created_at: Date
}

export function mapTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    status: row.status as TenantStatus,
    createdAt: row.created_at.toISOString(),
  }
}

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001'

export async function getDefaultTenant(pool: pg.Pool): Promise<string> {
  return DEFAULT_TENANT_ID
}

export async function getTenant(pool: pg.Pool, id: string): Promise<Tenant | null> {
  const res = await pool.query<TenantRow>('SELECT * FROM tenants WHERE id = $1', [id])
  return res.rows[0] ? mapTenant(res.rows[0]) : null
}

export async function listTenants(pool: pg.Pool): Promise<Tenant[]> {
  const res = await pool.query<TenantRow>('SELECT * FROM tenants ORDER BY created_at ASC')
  return res.rows.map(mapTenant)
}

export async function createTenant(pool: pg.Pool, name: string): Promise<Tenant> {
  const res = await pool.query<TenantRow>(
    `INSERT INTO tenants (name) VALUES ($1) RETURNING *`,
    [name],
  )
  return mapTenant(res.rows[0]!)
}

export async function suspendTenant(pool: pg.Pool, id: string): Promise<Tenant | null> {
  const res = await pool.query<TenantRow>(
    `UPDATE tenants SET status = 'suspended' WHERE id = $1 AND status = 'active' RETURNING *`,
    [id],
  )
  return res.rows[0] ? mapTenant(res.rows[0]) : null
}

/** 登录引导：无租户用户自动入 default 租户，返回 tenantId */
export async function ensureUserTenant(pool: pg.Pool, userId: string): Promise<string> {
  const res = await pool.query<{ tenant_id: string | null }>('SELECT tenant_id FROM users WHERE user_id = $1', [userId])
  if (res.rows[0]?.tenant_id) return res.rows[0].tenant_id
  await pool.query(`UPDATE users SET tenant_id = $2 WHERE user_id = $1 AND tenant_id IS NULL`, [userId, DEFAULT_TENANT_ID])
  return DEFAULT_TENANT_ID
}

/** 租户状态检查（停用 → 登录拒绝） */
export async function isTenantActive(pool: pg.Pool, tenantId: string): Promise<boolean> {
  const res = await pool.query<{ status: string }>('SELECT status FROM tenants WHERE id = $1', [tenantId])
  return res.rows[0]?.status === 'active'
}

/** 管理员转移用户租户（null = 移出租户，登录时回 default） */
export async function transferUserTenant(
  pool: pg.Pool,
  userId: string,
  tenantId: string | null,
): Promise<void> {
  await pool.query(`UPDATE users SET tenant_id = $2 WHERE user_id = $1`, [userId, tenantId])
}
