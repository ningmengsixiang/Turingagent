# Phase 3 · 计划 28：监控（Prometheus 指标端点）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地运维监控（DEPLOYMENT.md §8 记录项）：Prometheus 指标端点 `GET /metrics`（HTTP 请求量/消息量/智能体调用与 token/配额用量/WS 连接数/超时升级次数）+ 指标采集说明。Prometheus 抓取与 Grafana 告警配置记后续（提供标准端点即接入）。

**Architecture:** 新增依赖 `prom-client`（gateway）→ `src/metrics.ts`（计数器/gauge 注册：http_requests_total{route,status}、messages_created_total、agent_runs_total{agent}、agent_tokens_total、quota_used/quota_budget、ws_connections、escalation_runs_total；`metricsMiddleware`（onResponse 计数）与 `registerMetricsRoutes`（GET /metrics 无鉴权——与 /healthz 一致，供抓取））→ `server.ts` 注册（metrics 路由**不挂 auth**）→ `agent/bridge.ts` run 成功/熔断/升级计数 → `ws.ts` 连接计数 → 配额读取 gauge。测试：metrics.test.ts——GET /metrics 返回 Prometheus 格式（# HELP/# TYPE 头 + 指标名），发请求后 http_requests_total 递增。

**Tech Stack:** `prom-client`（Prometheus 标准库）+ Fastify。

**质量审查决策（T1-T3 后追加）：** ① messages 计数顶层独立监听（与 agent 启停无关）；② WS counted 守卫（鉴权成功才 inc、close 单次 dec，error 后必 close 无泄漏）；③ route 用 request.routeOptions.url（Fastify 5 等价）；④ 提交边界偏离合理（T1 含 quota gauge、T3 含 server.ts、83ad528 修正）。**记录后续**：metrics 埋点无直接测试断言（可选补）；bridge success 埋点在持久化前（complete 成功但持久化失败会双计 success+error，可后移）；/metrics DB 故障时 500（Prometheus 记 scrape 失败）。

**决策记录：** 用 prom-client（标准格式，后续 Grafana 直接可用）；`/metrics` 无鉴权（与 /healthz 一致——生产在 LB/内网暴露，公网需网络隔离）；HTTP 计数用 onResponse hook（route 匹配——Fastify reply.routeOptions.url 取 route）；指标覆盖核心可观测面（消息/agent/配额/WS/升级）；配额 gauge 每次 /metrics 拉取时实时读（prom-client 的 collect 回调或缓存刷新）；`agent_runs_total` 标签含 agent id 与 outcome（success/quota/error）；DEPLOYMENT.md §8 更新为已落地 + Grafana 配置指引。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/package.json` | 修改 | 增 prom-client 依赖 |
| `services/gateway/src/metrics.ts` | 创建 | 指标注册 + 中间件 + 路由 |
| `services/gateway/src/server.ts` | 修改 | 注册 metrics 路由（无鉴权）+ hook |
| `services/gateway/src/agent/bridge.ts` | 修改 | agent 调用/token/熔断计数 |
| `services/gateway/src/ws.ts` | 修改 | WS 连接 gauge |
| `services/gateway/src/metrics.test.ts` | 创建 | 指标端点测试 |
| `DEPLOYMENT.md` | 修改 | 监控节落地 |

---

## Task 1: 指标库 + 端点

**Files:**
- Modify: `services/gateway/package.json`
- Create: `services/gateway/src/metrics.ts`
- Modify: `services/gateway/src/server.ts`

- [x] **Step 1: 增 prom-client 依赖**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway add prom-client
```

- [x] **Step 2: 写 metrics.ts**

创建 `services/gateway/src/metrics.ts`：

```ts
import { Counter, Gauge, Registry } from 'prom-client'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

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

/** /metrics 端点（无鉴权——与 /healthz 一致，供 Prometheus 抓取） */
export function registerMetricsRoutes(app: FastifyInstance): void {
  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', metricsRegistry.contentType)
    return metricsRegistry.metrics()
  })
}
```

- [x] **Step 3: server.ts 注册**

读 `services/gateway/src/server.ts`：
1. import 增 `registerMetricsRoutes, metricsOnResponse` from './metrics.js'。
2. `registerHealth(app)` 附近注册 `registerMetricsRoutes(app)`（**无 auth**）。
3. `app.addHook('onResponse', metricsOnResponse)`。

- [x] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
```

Expected: typecheck exit 0。

- [x] **Step 5: 提交**

```bash
git add services/gateway/package.json services/gateway/src/metrics.ts services/gateway/src/server.ts pnpm-lock.yaml
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(metrics): Prometheus 指标端点（HTTP/消息/WS 计数）"
```

---

## Task 2: 业务指标埋点

**Files:**
- Modify: `services/gateway/src/agent/bridge.ts`
- Modify: `services/gateway/src/ws.ts`
- Modify: `services/gateway/src/scheduler.ts`

- [x] **Step 1: bridge.ts 埋点**

读 `services/gateway/src/agent/bridge.ts`，import 增 `agentRunsTotal, agentTokensTotal`；`runAgent` 内三处：
1. 熔断分支（quota trip）：`agentRunsTotal.inc({ agent: agent.id, outcome: 'quota' })`。
2. 成功（provider.complete 后）：`agentRunsTotal.inc({ agent: agent.id, outcome: 'success' })` + `agentTokensTotal.inc(completion.promptTokens + completion.completionTokens)`。
3. error reply 分支：`agentRunsTotal.inc({ agent: agent.id, outcome: 'error' })`。

- [x] **Step 2: ws.ts 连接计数**

读 `services/gateway/src/ws.ts`，import 增 `wsConnections`；连接建立 `wsConnections.inc()`，close 时 `wsConnections.dec()`（找到 socket close 处理处）。

- [x] **Step 3: scheduler.ts 升级计数**

读 `services/gateway/src/scheduler.ts`，import 增 `escalationRunsTotal`；`runEscalationTick` 升级后 `escalationRunsTotal.inc(escalated.length)`。

- [x] **Step 4: 配额 gauge 实时**

读 `services/gateway/src/routes/org.ts` 或 getQuota 调用处——`/metrics` 拉取时配额 gauge 需实时。**方案**：metrics.ts 的 /metrics handler 内调用 `getQuota(pool)` 更新 gauge（需 pool——registerMetricsRoutes 增参数）。修改：

```ts
export function registerMetricsRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/metrics', async (_request, reply) => {
    const quota = await getQuota(pool)
    quotaUsed.set(quota.used)
    quotaBudget.set(quota.budget)
    reply.header('content-type', metricsRegistry.contentType)
    return metricsRegistry.metrics()
  })
}
```

（import 增 getQuota from './repos/quota.js'；server.ts 调用处传 pool。）

- [x] **Step 5: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
```

Expected: typecheck exit 0。

- [x] **Step 6: 提交**

```bash
git add services/gateway/src/agent/bridge.ts services/gateway/src/ws.ts services/gateway/src/scheduler.ts services/gateway/src/metrics.ts services/gateway/src/server.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(metrics): 业务指标埋点（agent 调用/token/WS/升级/配额）"
```

---

## Task 3: 测试 + DEPLOYMENT + 验收 + 推送

**Files:**
- Create: `services/gateway/src/metrics.test.ts`
- Modify: `DEPLOYMENT.md`

- [x] **Step 1: metrics.test.ts**

创建 `services/gateway/src/metrics.test.ts`（复用既有路由测试风格）：

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('metrics', () => {
  let built: BuiltApp
  let pool: pg.Pool

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
    built = await buildApp({ databaseUrl: 'postgres://ta:ta@localhost:5432/ta_dev' })
  })
  afterEach(async () => {
    await built.app.close()
  })

  it('exposes prometheus metrics without auth', async () => {
    const res = await built.app.inject({ method: 'GET', url: '/metrics' })
    expect(res.statusCode).toBe(200)
    const text = res.body
    expect(text).toContain('# HELP')
    expect(text).toContain('http_requests_total')
    expect(text).toContain('quota_used')
    expect(text).toContain('ws_connections')
  })

  it('counts http requests per route', async () => {
    await built.app.inject({ method: 'GET', url: '/metrics' })
    await built.app.inject({ method: 'GET', url: '/healthz' })
    const text = (await built.app.inject({ method: 'GET', url: '/metrics' })).body
    expect(text).toContain('http_requests_total{route="/healthz",status="200"} 1')
  })
})
```

- [x] **Step 2: DEPLOYMENT.md §8 更新**

读 DEPLOYMENT.md §8（监控建议），替换为已落地说明：

```markdown
## 8. 监控
- 指标端点：`GET /metrics`（Prometheus 格式，无鉴权——生产在 LB/内网暴露）：`http_requests_total`（按 route/status）、`messages_created_total`、`agent_runs_total`（按 agent/outcome）、`agent_tokens_total`、`quota_used`/`quota_budget`、`ws_connections`、`escalation_runs_total`
- 抓取：Prometheus scrape 配置示例：
  ```yaml
  scrape_configs:
    - job_name: ta-gateway
      static_configs:
        - targets: ['gateway:3001']
  ```
- 告警建议（Grafana）：gateway 不可达 / quota_used/quota_budget > 0.8（配额 80% 预警）/ agent_runs_total 错误率 > 10% / 审批超时升级 escalation_runs_total 增长
- 日志采集：容器 stdout（docker compose logs / K8s 收集）记后续
```

- [x] **Step 3: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose src/metrics.test.ts
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；metrics.test.ts 2 用例 PASS；全量 gateway 206 用例（204+2）全 PASS。

- [x] **Step 4: 提交**

```bash
git add services/gateway/src/metrics.test.ts DEPLOYMENT.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(metrics): 指标端点测试 + DEPLOYMENT 监控节落地"
```

- [x] **Step 5: 全仓验收 + 推送**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
git push
```

Expected: 全绿；推送成功（CI 应绿）。

- [x] **Step 6: 真实验收**

```bash
cd /tmp
# 1) 本地起 gateway → GET /metrics → 含 # HELP/http_requests_total/quota_used/ws_connections
# 2) 发几条请求 → 再 GET /metrics → http_requests_total{route=...} 递增
# 3) 发一条 @智能体消息 → agent_runs_total{outcome=success} 递增 + agent_tokens_total 增长
```

---

## Self-Review 记录

- **Spec 覆盖**：DEPLOYMENT §8 记录项（监控）→ /metrics 端点 + 业务指标 + 告警建议；可观测面（消息/agent/配额/WS/升级）覆盖核心。
- **占位符扫描**：无 TBD；代码逐字给出。
- **类型一致性**：指标名/标签在 metrics.ts 注册与测试断言一致；registerMetricsRoutes(pool) 签名在 server.ts 调用一致。
- **已知取舍**：/metrics 无鉴权（LB/内网隔离）；配额 gauge 拉取时实时读（每 scrape 一次 DB 查询，可接受）；日志采集/Grafana 部署记后续；prom-client 默认注册表用自定义 Registry（隔离测试）。
