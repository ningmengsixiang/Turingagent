import { createHash, randomBytes } from 'node:crypto'
import pg from 'pg'
import type { ApiKeyInfo } from '@ta/contracts'

export interface ApiKeyRow {
  id: string
  key_hash: string
  name: string
  member_user_id: string
  created_by: string
  created_at: Date
  revoked_at: Date | null
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

function maskKey(key: string): string {
  return `ta_****${key.slice(-6)}`
}

export interface CreatedApiKey {
  /** 仅此一次返回明文 */
  key: string
  info: ApiKeyInfo
}

export function mapApiKeyInfo(row: ApiKeyRow): ApiKeyInfo {
  return {
    id: row.id,
    name: row.name,
    maskedKey: maskKey(row.key_hash.slice(-8)),
    memberUserId: row.member_user_id,
    createdAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString(),
  }
}

export async function createApiKey(
  pool: pg.Pool,
  input: { name: string; memberUserId: string; createdBy: string },
): Promise<CreatedApiKey> {
  const key = `ta_${randomBytes(24).toString('base64url')}`
  const keyHash = hashKey(key)
  const res = await pool.query<ApiKeyRow>(
    `INSERT INTO api_keys (key_hash, name, member_user_id, created_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [keyHash, input.name, input.memberUserId, input.createdBy],
  )
  return { key, info: mapApiKeyInfo(res.rows[0]!) }
}

export async function listApiKeys(pool: pg.Pool): Promise<ApiKeyInfo[]> {
  const res = await pool.query<ApiKeyRow>('SELECT * FROM api_keys ORDER BY created_at DESC')
  return res.rows.map(mapApiKeyInfo)
}

export async function revokeApiKey(pool: pg.Pool, id: string): Promise<ApiKeyInfo | null> {
  const res = await pool.query<ApiKeyRow>(
    `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING *`,
    [id],
  )
  return res.rows[0] ? mapApiKeyInfo(res.rows[0]) : null
}

/** 校验 key：返回绑定用户 id（未撤销） */
export async function verifyApiKey(pool: pg.Pool, key: string): Promise<string | null> {
  const keyHash = hashKey(key)
  const res = await pool.query<{ member_user_id: string }>(
    'SELECT member_user_id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL',
    [keyHash],
  )
  return res.rows[0]?.member_user_id ?? null
}
