import { Counter, Gauge, Registry } from 'prom-client'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getQuota } from './repos/quota.js'
import type pg from 'pg'

export const metricsRegistry = new Registry()

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'HTTP 请求总数（按 route 与状态码）',
  labelNames: ['route', 'status'],
  registers: [metricsRegistry],
})

export const messagesCreatedTotal = new Counter({
  name: 'messages_created_total',
  help: '消息创建总数',
  registers: [metricsRegistry],
})

export const agentRunsTotal = new Counter({
  name: 'agent_runs_total',
  help: '智能体运行总数（按 agent 与结果）',
  labelNames: ['agent', 'outcome'],
  registers: [metricsRegistry],
})

export const agentTokensTotal = new Counter({
  name: 'agent_tokens_total',
  help: '智能体消耗 token 总数',
  registers: [metricsRegistry],
})

export const quotaUsed = new Gauge({
  name: 'quota_used',
  help: '企业配额已用 tokens',
  registers: [metricsRegistry],
})

export const quotaBudget = new Gauge({
  name: 'quota_budget',
  help: '企业配额预算 tokens',
  registers: [metricsRegistry],
})

export const wsConnections = new Gauge({
  name: 'ws_connections',
  help: 'WebSocket 活跃连接数',
  registers: [metricsRegistry],
})

export const escalationRunsTotal = new Counter({
  name: 'escalation_runs_total',
  help: '审批超时升级总次数',
  registers: [metricsRegistry],
})

/** HTTP 请求计数 hook：onResponse 按 route 与 status 计数 */
export async function metricsOnResponse(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const route = request.routeOptions?.url ?? 'unknown'
  httpRequestsTotal.inc({ route, status: String(reply.statusCode) })
}

/** /metrics 端点（无鉴权——与 /healthz 一致，供 Prometheus 抓取；配额 gauge 每次拉取时实时读） */
export function registerMetricsRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/metrics', async (_request, reply) => {
    const quota = await getQuota(pool)
    quotaUsed.set(quota.used)
    quotaBudget.set(quota.budget)
    reply.header('content-type', metricsRegistry.contentType)
    return metricsRegistry.metrics()
  })
}
