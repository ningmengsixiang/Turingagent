import type { FastifyReply, FastifyRequest } from 'fastify'
import { verifyToken, type JwtUser } from './auth.js'
import type { Config } from './config.js'
import { upsertUser } from './repos/users.js'
import type pg from 'pg'

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtUser
  }
}

/** 鉴权核心：验 JWT → upsert 用户（确保存在并取得实时 role）→ 挂 request.user */
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
  const member = await upsertUser(pool, user.id, user.name)
  request.user = { ...user, role: member.role }
  return true
}

export function requireAuth(config: Config, pool: pg.Pool) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply, config, pool)
  }
}

/** admin-only 路由守卫：鉴权通过且 role === 'admin' 才放行 */
export function requireRoleFor(config: Config, pool: pg.Pool) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ok = await authenticate(request, reply, config, pool)
    if (!ok) return
    if (request.user!.role !== 'admin') {
      await reply.code(403).send({ error: 'requires role: admin' })
    }
  }
}
