import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verifyApiKey } from '../repos/api-keys.js'
import { isMember } from '../repos/sessions.js'
import { createMessage, listMessages } from '../repos/messages.js'
import { recordAudit } from '../repos/audit.js'
import type { Config } from '../config.js'
import type { RateLimiter } from '../rate-limit.js'
import pg from 'pg'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_LIMIT = 100

/** 外部系统鉴权：X-API-Key → 绑定用户 id（挂 request.apiKeyUser）；认证通过后按 key 限流（429 + Retry-After） */
function apiKeyAuth(config: Config, pool: pg.Pool, rateLimiter: RateLimiter) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.headers['x-api-key']
    if (typeof key !== 'string' || key.length === 0) {
      return reply.code(401).send({ error: 'X-API-Key header is required' })
    }
    const memberUserId = await verifyApiKey(pool, key)
    if (!memberUserId) {
      return reply.code(401).send({ error: 'invalid or revoked api key' })
    }
    ;(request as FastifyRequest & { apiKeyUser?: string }).apiKeyUser = memberUserId
    // 开放 API 限流（FR-SEC-03）：认证通过后按绑定用户 key 检查——两个外部端点共享
    // Redis 后端 incr 失败（连接不可用）→ 降级放行（fail-open）+ 警告日志（决策记录）
    let rl: { allowed: boolean; retryAfterSec: number }
    try {
      rl = await rateLimiter.check(memberUserId)
    } catch (err) {
      console.warn('[ratelimit] check failed, allowing request (fail-open):', (err as Error).message)
      return
    }
    if (!rl.allowed) {
      return reply.code(429).header('Retry-After', rl.retryAfterSec).send({ error: 'rate limit exceeded' })
    }
  }
}

export function registerExternalRoutes(
  app: FastifyInstance,
  config: Config,
  pool: pg.Pool,
  rateLimiter: RateLimiter,
): void {
  const auth = apiKeyAuth(config, pool, rateLimiter)

  // 外部系统向会话发消息（以绑定用户身份）
  app.post<{ Params: { id: string }; Body: { content?: string } }>(
    '/api/v1/external/sessions/:id/messages',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      if (!UUID_PATTERN.test(sessionId)) {
        return reply.code(400).send({ error: 'session id must be a uuid' })
      }
      const apiKeyUser = (request as FastifyRequest & { apiKeyUser?: string }).apiKeyUser!
      const content = request.body?.content?.trim()
      if (!content || content.length > 10_000) {
        return reply.code(400).send({ error: 'content is required (<=10000 chars)' })
      }
      // FR-SEC-02：外部路径无 JWT user，取绑定用户 DB 租户作期望值（会话租户须匹配绑定用户租户）
      const boundTenant = await getUserTenant(pool, apiKeyUser)
      if (!(await isMember(pool, sessionId, apiKeyUser, boundTenant))) {
        return reply.code(403).send({ error: 'bound user is not a member of this session' })
      }
      const { message } = await createMessage(pool, {
        sessionId,
        senderId: apiKeyUser,
        senderKind: 'human',
        contentType: 'text',
        content,
        clientMsgId: `ext-${randomUUID()}`,
      })
      void recordAudit(pool, {
        actorId: apiKeyUser,
        action: 'external.message_created',
        target: message.id,
        detail: { sessionId },
      }).catch((err) => console.error('[audit] external call failed:', err))
      return reply.code(201).send({ message })
    },
  )

  // 外部系统查询会话消息
  app.get<{ Params: { id: string }; Querystring: { after_seq?: string } }>(
    '/api/v1/external/sessions/:id/messages',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      if (!UUID_PATTERN.test(sessionId)) {
        return reply.code(400).send({ error: 'session id must be a uuid' })
      }
      const apiKeyUser = (request as FastifyRequest & { apiKeyUser?: string }).apiKeyUser!
      // FR-SEC-02：外部路径无 JWT user，取绑定用户 DB 租户作期望值（会话租户须匹配绑定用户租户）
      const boundTenant = await getUserTenant(pool, apiKeyUser)
      if (!(await isMember(pool, sessionId, apiKeyUser, boundTenant))) {
        return reply.code(403).send({ error: 'bound user is not a member of this session' })
      }
      const afterSeq = Number(request.query.after_seq ?? 0)
      // 适配：listMessages(pool, sessionId, afterSeq, limit) 返回 Message[]（非 { messages }）
      const messages = await listMessages(pool, sessionId, Number.isFinite(afterSeq) ? afterSeq : 0, MAX_LIMIT)
      return { messages }
    },
  )
}

/** 取用户 DB 租户（外部 API-Key 路径无 JWT user；无租户用户返回 undefined → isMember 退化为旧行为） */
async function getUserTenant(pool: pg.Pool, userId: string): Promise<string | undefined> {
  const res = await pool.query<{ tenant_id: string | null }>('SELECT tenant_id FROM users WHERE user_id = $1', [userId])
  return res.rows[0]?.tenant_id ?? undefined
}
