import type { FastifyReply, FastifyRequest } from 'fastify'
import { verifyToken, type JwtUser } from './auth.js'
import type { Config } from './config.js'
import { getUserRoleWithTenant, upsertUser } from './repos/users.js'
import { ensureUserTenant, isTenantActive } from './repos/tenants.js'
import type pg from 'pg'

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtUser & { tenantId?: string }
  }
}

/** 鉴权核心：验 JWT → 读实时 role + tenant_id（首次请求 upsert 注册）→ 租户闸门 → 挂 request.user */
async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  config: Config,
  pool: pg.Pool,
): Promise<boolean> {
  const match = /^Bearer\s+(\S+)$/.exec(request.headers.authorization ?? '')
  if (!match) {
    await reply.code(401).send({ error: 'malformed authorization header' })
    return false
  }
  const user = await verifyToken(match[1]!, config)
  if (!user) {
    await reply.code(401).send({ error: 'invalid token' })
    return false
  }
  try {
    // 热路径：一次查询取 role + tenant_id（无写）；首次请求才 upsert 注册（M2 写放大修复）
    let info = await getUserRoleWithTenant(pool, user.id)
    if (info === null) {
      const member = await upsertUser(pool, user.id, user.name)
      info = { role: member.role, tenantId: null }
    }
    // 登录引导：无租户用户自动入 default 租户（与登录路由一致；一次性，之后热路径只读）
    const tenantId = info.tenantId ?? (await ensureUserTenant(pool, user.id))
    // 租户闸门（FR-SEC-02）：停用租户成员每次请求 403
    if (!(await isTenantActive(pool, tenantId))) {
      await reply.code(403).send({ error: '租户已停用' })
      return false
    }
    request.user = { ...user, role: info.role, tenantId }
  } catch {
    // 鉴权基础设施故障 → 503（M3：非 500）
    await reply.code(503).send({ error: 'auth service unavailable' })
    return false
  }
  return true
}

export function requireAuth(config: Config, pool: pg.Pool) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply, config, pool)
  }
}

export function requireRoleFor(config: Config, pool: pg.Pool) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ok = await authenticate(request, reply, config, pool)
    if (!ok) return
    if (request.user!.role !== 'admin') {
      await reply.code(403).send({ error: 'requires role: admin' })
      return
    }
  }
}
