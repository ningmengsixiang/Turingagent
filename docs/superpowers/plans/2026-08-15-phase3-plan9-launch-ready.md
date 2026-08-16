# Phase 3 · 计划 27：上线就绪（优雅关闭 + 开放 API 限流 + 部署运维手册）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成发布上线就绪：① 优雅关闭（SIGTERM/SIGINT → 停止调度器 → 关闭 HTTP/WS → 释放连接池）；② 开放 API 限流（内存令牌桶，防外部滥用）；③ 部署运维手册（DEPLOYMENT.md：生产部署/健康检查/备份恢复/升级/故障排查）。生产镜像构建与 compose 端到端已在计划执行前实测通过（Dockerfile tsconfig 修复 + minio console 端口可配置已提交）。

**Architecture:** ① `src/index.ts` 增 `process.on('SIGTERM'/'SIGINT')` → `scheduler.stop()` → `app.close()` → `pool.end()` → exit 0（超时兜底 exit 1）；② `routes/external.ts` 增内存限流（每 key 每 60s 上限，默认 60 次/分钟，config `EXTERNAL_RATE_LIMIT`；超限 429 + Retry-After；用 Map<key, {count, resetAt}> 简单令牌桶，定期清理）；③ `DEPLOYMENT.md` 运维手册（部署步骤（compose/K8s）、健康检查（/healthz）、备份（pg_dump + MinIO 卷）、恢复、升级（迁移自动）、故障排查（日志/容器状态）、安全基线（TLS/强密钥/限流））。

**Tech Stack:** Node 信号处理 + 内存令牌桶 + Markdown 手册。无新依赖。

**质量审查决策（T1-T3 后追加）：** ① DEPLOYMENT §2.3 验证 curl 补 content-type（无头 415 实测）；② pool.end 双保险（server.ts onClose 已 end——显式 end 吞预期重复错误，其他错误仍 exit 1）；③ WS 由 @fastify/websocket preClose 钩子关闭（app.close 覆盖 ✓）；④ buildApp overrides 原生支持 externalRateLimit（无需改 server.ts）；⑤ 限流桶不清理但 key 数=用户数有界（可接受）。**记录后续**：多副本限流（Redis 计数）、监控（Prometheus 指标）、优雅关闭自动化测试（当前真实验收覆盖）。

**决策记录：** 优雅关闭用进程信号处理（K8s/Compose 均发 SIGTERM；`app.close()` 等存量连接关闭 + 超时兜底）；限流用内存令牌桶（单实例；多副本限流记后续 Redis 计数）；限流默认 60 次/分钟/API key（config 可调；开放 API 外部端点专用——内部端点不限）；DEPLOYMENT.md 为运维真源（README 链接引用，不重复）；生产验证已实测（gateway/web 镜像构建成功、compose 全链路含真实 LLM 通过）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/src/index.ts` | 修改 | 优雅关闭（信号处理） |
| `services/gateway/src/config.ts` | 修改 | externalRateLimit 配置 |
| `services/gateway/src/routes/external.ts` | 修改 | 开放 API 限流 |
| `services/gateway/src/routes/external.test.ts` | 修改 | 限流测试 |
| `DEPLOYMENT.md` | 创建 | 部署运维手册 |
| `README.md` | 修改 | 链接 DEPLOYMENT.md |

---

## Task 1: 优雅关闭

**Files:**
- Modify: `services/gateway/src/index.ts`

- [x] **Step 1: 信号处理**

读 `services/gateway/src/index.ts`，把现有 try/catch 改造成含优雅关闭：

```ts
import { buildApp } from './server.js'
import { startScheduler } from './scheduler.js'

const built = await buildApp()
// 自动定时器（FR-APP-06）：进程内 cron 每小时升级超时审批（不进 buildApp——测试环境不启动，避免定时器悬挂）
const scheduler = startScheduler(built.pool, built.config.escalationCron)
const { app, config, pool } = built

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[gateway] received ${signal}, shutting down...`)
  // 停止定时器 → 停止接收新连接 → 释放连接池（超时兜底）
  const timer = setTimeout(() => {
    console.error('[gateway] shutdown timed out, forcing exit')
    process.exit(1)
  }, 10_000)
  timer.unref()
  try {
    scheduler.stop()
    await app.close()
    await pool.end()
    console.log('[gateway] shutdown complete')
    process.exit(0)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`gateway listening on http://0.0.0.0:${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
```

> 注：`app.close()` 会等存量连接（Fastify 支持 close 等待 in-flight）；WS 连接由 @fastify/websocket 注册的 close 钩子关闭（核对——若 app.close 不关 WS，记录并接受（进程退出即断））。`timer.unref()` 防阻塞进程。

- [x] **Step 2: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
```

Expected: typecheck exit 0。

- [x] **Step 3: 提交**

```bash
git add services/gateway/src/index.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(ops): 优雅关闭（SIGTERM/SIGINT → 停调度/关服务/释放池）"
```

---

## Task 2: 开放 API 限流

**Files:**
- Modify: `services/gateway/src/config.ts`
- Modify: `services/gateway/src/routes/external.ts`
- Modify: `services/gateway/src/routes/external.test.ts`

- [x] **Step 1: config 增 externalRateLimit**

读 `services/gateway/src/config.ts`，Config 接口增 `externalRateLimit: number`，loadConfig 增：

```ts
  externalRateLimit: Number(env.EXTERNAL_RATE_LIMIT ?? 60),
```

（Number 解析——非法值回退默认：`const externalRateLimit = Number(env.EXTERNAL_RATE_LIMIT ?? 60); ... externalRateLimit: Number.isFinite(externalRateLimit) && externalRateLimit > 0 ? externalRateLimit : 60`，与现有配置校验风格一致。）

- [x] **Step 2: external.ts 限流中间件**

读 `services/gateway/src/routes/external.ts`（apiKeyAuth 现状），新增内存令牌桶中间件（apiKeyAuth 之后应用）：

```ts
/** 内存令牌桶：每 key 每窗口（60s）限 externalRateLimit 次；超限 429 */
function createRateLimiter(limit: number, windowMs = 60_000) {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  return (key: string): { allowed: boolean; retryAfterSec: number } => {
    const now = Date.now()
    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return { allowed: true, retryAfterSec: 0 }
    }
    if (bucket.count >= limit) {
      return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) }
    }
    bucket.count += 1
    return { allowed: true, retryAfterSec: 0 }
  }
}
```

在 `registerExternalRoutes` 内（auth 之后）创建 `const rateLimit = createRateLimiter(config.externalRateLimit)`，两个 external 端点 preHandler 链或内部调用：`apiKeyAuth` 挂 `request.apiKeyUser` 后，调 `rateLimit(apiKeyUser)`——超限 `reply.code(429).header('Retry-After', retryAfterSec).send({ error: 'rate limit exceeded' })`。**实现**：把限流检查放进 apiKeyAuth 内部（认证通过后检查）——两个端点共享。

- [x] **Step 3: 测试**

读 `services/gateway/src/routes/external.test.ts`（api-keys.test.ts？核对文件名——external 测试在 api-keys.test.ts 的用例 3；**新增限流专用测试文件** `services/gateway/src/routes/external.test.ts` 或复用），追加限流用例：

```ts
  it('rate limits external api calls', async () => {
    const admin = await loginAs('alice')
    const created = await built.app.inject({ method: 'POST', url: '/api/v1/api-keys', headers: { authorization: `Bearer ${admin}` }, payload: { name: '限流测试', memberUser: 'alice' } })
    const key = created.json().key as string
    const session = await built.app.inject({ method: 'POST', url: '/api/v1/sessions', headers: { authorization: `Bearer ${admin}` }, payload: { kind: 'project', title: '限流', memberIds: ['u-bob'] } })
    const sessionId = session.json().session.id as string
    // 限流阈值低（用 config 覆盖）：buildApp 时 externalRateLimit 默认 60——测试连续打 61 次太慢。
    // 方案：buildApp 覆盖 externalRateLimit: 3 → 前 3 次 200，第 4 次 429。
  })
```

> 注：需 buildApp 支持 externalRateLimit 覆盖（读 server.ts 的 buildApp overrides——config 覆盖机制：`buildApp(overrides)` 合并 config？读现状确认；若不支持，用 config 默认 60 但测试打 61 次（循环快，可行）或用 env EXTERNAL_RATE_LIMIT 覆盖——**推荐**：buildApp overrides 已支持 config 字段覆盖（读 server.ts buildApp 的 merge 逻辑），测试传 `{ externalRateLimit: 3 }`）。

- [x] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose src/routes/external.test.ts
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；限流用例 PASS；全量 204 用例（203+1）全 PASS。

- [x] **Step 5: 提交**

```bash
git add services/gateway/src/config.ts services/gateway/src/routes/external.ts services/gateway/src/routes/external.test.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(ops): 开放 API 限流（内存令牌桶，可配置）"
```

---

## Task 3: 部署运维手册

**Files:**
- Create: `DEPLOYMENT.md`
- Modify: `README.md`

- [x] **Step 1: 写 DEPLOYMENT.md**

创建 `DEPLOYMENT.md`，内容覆盖：

```markdown
# Turing Agent 部署运维手册

## 1. 架构与端口
- 四服务：db (postgres:16) / minio / gateway (Fastify :3001) / web (nginx :80 反代 /api /ws)
- 生产 Compose：`deploy/prod/`；K8s：`deploy/k8s/`

## 2. 生产部署（Docker Compose）
1. `cd deploy/prod && cp .env.example .env`，编辑必填：JWT_SECRET（≥32 字符强随机）/ MODEL_API_KEY / POSTGRES_PASSWORD（≥8）/ MINIO_ROOT_PASSWORD（≥8）
2. `./install.sh`（校验 → 构建镜像 → 启动 → 健康检查 → 输出访问地址）
3. 验证：`curl localhost:8080/api/v1/auth/login -X POST -d '{"username":"admin"}'`（200）
4. K8s：`cd deploy/k8s && IMAGE_PREFIX=... TA_HOST=... MODEL_API_KEY=... ./install.sh`

## 3. 健康检查
- `GET /healthz` → `{"status":"ok"}`（无鉴权，供 LB/探针）
- Compose healthcheck：db pg_isready / gateway login 探测 / web depends_on

## 4. 备份与恢复
- 数据库：`docker compose -f deploy/prod/docker-compose.prod.yml exec db pg_dump -U ta ta_prod > backup.sql`
- 恢复：`docker compose ... exec -T db psql -U ta ta_prod < backup.sql`
- 对象存储：MinIO 数据卷 `ta-prod-minio-data`（备份目录即可，或 mc mirror）
- 建议：每日 pg_dump + 卷快照；备份验证（恢复演练）季度一次

## 5. 升级
1. 拉新代码 → `docker compose -f deploy/prod/docker-compose.prod.yml build`（gateway/web 镜像）
2. `docker compose ... up -d`（迁移自动执行——gateway 启动前 `node lib/migrate.js`）
3. 验证 `/healthz` + 登录 + 一条消息
4. 回滚：`git checkout <旧版本>` + 重建镜像 + up -d（迁移为幂等增量，向前兼容）

## 6. 故障排查
- 容器状态：`docker compose ... ps` / `docker compose ... logs --tail=100`
- gateway 未健康：查 `docker compose ... logs gateway`（迁移失败/DB 连接/模型 key 缺失）
- web 反代 502：gateway 未就绪（depends_on healthcheck 未过）
- 配额熔断：`POST /api/v1/org/quota {budget}` 调额（管理员）
- 租户停用误操作：`POST /api/v1/org/tenants/:id/suspend` 后可恢复（DB 直接 UPDATE tenants SET status='active'）

## 7. 安全基线
- 必须：强 JWT_SECRET / 修改默认密码 / HTTPS（TLS 终止于反代或 ingress）/ 端口绑 127.0.0.1 或防火墙
- 开放 API：X-API-Key 仅 HTTPS 传输；默认限流 60 次/分钟/key（`EXTERNAL_RATE_LIMIT` 可调）
- 审计：`audit_events` 表 append-only（审批/配额/租户/API Key 等操作留痕）
- 生产加固后续：RLS 双保险 / 多副本限流（Redis）/ 密钥管理（KMS）

## 8. 监控建议（后续）
- Prometheus 指标端点 / 日志采集 / 告警（gateway 健康、配额 80%、审批超时升级）
```

- [x] **Step 2: README 链接**

读 README，在「### 私有化部署（M2.5）」节末尾追加链接：

```markdown
完整部署与运维手册见 [`DEPLOYMENT.md`](DEPLOYMENT.md)（架构/部署/健康检查/备份恢复/升级/故障排查/安全基线）。
```

- [x] **Step 3: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
git diff --check
```

Expected: 无空白错误。

- [x] **Step 4: 提交**

```bash
git add DEPLOYMENT.md README.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 部署运维手册 DEPLOYMENT.md（部署/健康/备份/升级/排查/安全）"
```

---

## Task 4: 全仓验收 + 推送

- [x] **Step 1: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
```

Expected: build 全过；test 全绿（contracts 2 + gateway 204 + web 34 ≈ 240）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净。

- [x] **Step 2: 优雅关闭真实验收**

```bash
cd /tmp
# 1) 本地起 gateway（NODE_ENV=development）
# 2) 发 SIGTERM → 观察日志 "[gateway] received SIGTERM, shutting down..." → "shutdown complete" → 进程退出 0
# 3) SIGINT 同理
```

- [x] **Step 3: 提交 + 推送**

```bash
git add docs/superpowers/plans/2026-08-15-phase3-plan9-launch-ready.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 27 全部勾选（上线就绪）"
git push
```

Expected: 推送成功（CI 应绿）。

---

## Self-Review 记录

- **Spec 覆盖**：上线就绪三件套（优雅关闭/开放 API 限流/运维手册）+ 生产构建实测（计划执行前已做：Dockerfile tsconfig 修复、minio console 端口可配置、compose 全链路含真实 LLM 通过）。FR-SEC（安全基线：强密钥/HTTPS/限流）→ 手册 + 限流；运维能力（健康检查/备份/恢复/升级）→ 手册。
- **占位符扫描**：无 TBD；代码/手册逐字给出。
- **类型一致性**：externalRateLimit 在 config/限流中间件/测试一致；shutdown 的 scheduler.stop/app.close/pool.end 与既有类型一致。
- **已知取舍**：内存限流单实例（多副本 Redis 记后续）；优雅关闭的 WS 长连接等待（app.close 覆盖度核对，进程退出兜底）；监控（Prometheus）记后续；生产镜像构建已在计划前实测（本计划记录验证结论）。
