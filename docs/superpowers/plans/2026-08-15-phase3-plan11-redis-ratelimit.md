# Phase 3 · 计划 29：Redis 多副本限流（可插拔后端）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地可插拔限流后端（DEPLOYMENT §7 记录项「多副本限流（Redis）」）：开放 API 限流从内存令牌桶升级为 Redis 固定窗口计数（INCR+EXPIRE，多副本共享），未配置 Redis 时回退内存后端；compose/K8s 部署补 redis 服务。单副本默认内存（零依赖），多副本配置 `RATE_LIMIT_BACKEND=redis` 启用。

**Architecture:** 新增依赖 `ioredis` → `src/rate-limit.ts` 重构为 `createRateLimiter(limit, windowMs, backend, redis?)`（backend: 'memory' | 'redis'；redis 用 `INCR key` + 首次 `EXPIRE 60`，key=`rl:<apiKeyUser>`；值 > limit → 429）→ config 增 `rateLimitBackend`/`redisUrl` → server.ts 按 backend 创建 Redis 客户端（`createRedisClient`，连不上时降级内存 + 警告日志）→ `registerExternalRoutes(app, config, pool, rateLimiter)` 接收注入的 limiter。部署：compose 加 redis 服务（ta-prod-redis）+ gateway env `RATE_LIMIT_BACKEND`/`REDIS_URL`；K8s 加 redis Deployment/Service。测试：内存后端既有用例不变；Redis 后端用例用真实本地 redis（`RATE_LIMIT_BACKEND=redis` 或注入 mock——**决策**：Redis 用例标记 `describe.skipIf(!process.env.REDIS_TEST)`，CI 无 Redis 自动跳过，本地 `REDIS_TEST=1` 跑真实 Redis 验证；另 ioredis 可 mock 单测计数逻辑）。

**Tech Stack:** `ioredis` + Redis（compose 服务）。

**质量审查决策（T1-T2 后追加）：** ① **must-fix**：Redis 降级内存失效（闭包捕获）——经可变容器 holder.current 转发生效（a89181c）；② ioredis v6 named import（default/named 双导出实测）；③ install.sh 补 redis.yaml（371c287）；④ fail-open 记录（宕机时放行不阻断 API——修复后降级内存仍限流）；⑤ Redis 测试用唯一 key（固定 key rt+60s TTL 同窗口重跑会先拒，可先 DEL）。

**决策记录：** 固定窗口计数（INCR+EXPIRE）够用（比滑动窗口简单，窗口边界突发可接受——限流目的防滥用非精确）；Redis key 含 apiKeyUser（每 key 独立桶）；Redis 不可用时降级内存（fail-open 还是 fail-closed？——**决策**：降级内存 + 警告日志，限流仍生效（单副本内存兜底），不阻断 API）；ioredis 连接懒加载（首次请求时才 connect，启动不阻塞）；CI 不加 Redis 服务（Redis 用例 skipIf 跳过，本地 REDIS_TEST=1 实测）；compose/K8s redis 用默认端口 6379、无密码（内网 127.0.0.1/集群内），生产加固（密码/TLS）记后续；`RATE_LIMIT_BACKEND` 默认 memory（单副本零依赖）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/package.json` | 修改 | 增 ioredis 依赖 |
| `services/gateway/src/config.ts` | 修改 | rateLimitBackend/redisUrl 配置 |
| `services/gateway/src/rate-limit.ts` | 创建 | 可插拔限流（memory/redis） |
| `services/gateway/src/routes/external.ts` | 修改 | 注入 rateLimiter |
| `services/gateway/src/server.ts` | 修改 | 创建 redis 客户端 + 注入 |
| `services/gateway/src/rate-limit.test.ts` | 创建 | 限流后端测试 |
| `deploy/prod/docker-compose.prod.yml` | 修改 | 增 redis 服务 |
| `deploy/k8s/redis.yaml` | 创建 | Redis Deployment/Service |
| `DEPLOYMENT.md` | 修改 | Redis 限流说明 |

---

## Task 1: 依赖 + 配置 + 可插拔限流

**Files:**
- Modify: `services/gateway/package.json`
- Modify: `services/gateway/src/config.ts`
- Create: `services/gateway/src/rate-limit.ts`
- Modify: `services/gateway/src/routes/external.ts`
- Modify: `services/gateway/src/server.ts`

- [x] **Step 1: 增 ioredis 依赖**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway add ioredis
pnpm --filter @ta/gateway add -D @types/ioredis-mock 2>/dev/null || true
```

（ioredis 自带类型；mock 可选。）

- [x] **Step 2: config 增限流后端配置**

读 `services/gateway/src/config.ts`，Config 接口增：

```ts
  rateLimitBackend: 'memory' | 'redis'
  redisUrl: string
```

loadConfig 增（校验非法值回退默认）：

```ts
  rateLimitBackend: env.RATE_LIMIT_BACKEND === 'redis' ? 'redis' : 'memory',
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
```

- [x] **Step 3: 写 rate-limit.ts**

创建 `services/gateway/src/rate-limit.ts`：

```ts
import type Redis from 'ioredis'

export interface RateLimiter {
  check(key: string): { allowed: boolean; retryAfterSec: number }
}

/** 内存固定窗口桶（单副本默认） */
export function createMemoryRateLimiter(limit: number, windowMs = 60_000): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  return {
    check(key) {
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
    },
  }
}

/** Redis 固定窗口计数（多副本共享；INCR + 首次 EXPIRE） */
export function createRedisRateLimiter(redis: Redis, limit: number, windowSec = 60): RateLimiter {
  return {
    check(key) {
      // 同步不可用——ioredis 异步；改为异步 check（见注）
      void redis
      return { allowed: true, retryAfterSec: 0 }
    },
  }
}
```

> **注**：Redis INCR 是异步的，限流 check 需异步化——`RateLimiter.check` 改返回 `Promise<{ allowed; retryAfterSec }>`，external 路由 await。内存版同步（直接返回 Promise.resolve 或保持同步包装）。**实现以异步版为准**：`check(key): Promise<{ allowed: boolean; retryAfterSec: number }>`；Redis 版：
> ```ts
> export function createRedisRateLimiter(redis: Redis, limit: number, windowSec = 60): RateLimiter {
>   return {
>     async check(key) {
>       const redisKey = `rl:${key}`
>       const count = await redis.incr(redisKey)
>       if (count === 1) await redis.expire(redisKey, windowSec)
>       if (count > limit) return { allowed: false, retryAfterSec: 0 }
>       return { allowed: true, retryAfterSec: 0 }
>     },
>   }
> }
> ```
> Redis 连接失败时 incr reject——external 路由 catch 降级放行（fail-open）+ 警告日志（决策记录）。

- [x] **Step 4: external.ts 注入限流器**

读 `services/gateway/src/routes/external.ts`，改 `registerExternalRoutes(app, config, pool, rateLimiter: RateLimiter)`（注入），`apiKeyAuth` 认证通过后 `const rl = await rateLimiter.check(apiKeyUser); if (!rl.allowed) 429`。删除原 createRateLimiter 内存实现（移到 rate-limit.ts）。

- [x] **Step 5: server.ts 创建后端**

读 `services/gateway/src/server.ts`，创建限流器：

```ts
import Redis from 'ioredis'
import { createMemoryRateLimiter, createRedisRateLimiter, type RateLimiter } from './rate-limit.js'

// ...（buildApp 内）：
  let rateLimiter: RateLimiter
  if (config.rateLimitBackend === 'redis') {
    const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 })
    rateLimiter = createRedisRateLimiter(redis, config.externalRateLimit)
    // 连接失败降级内存（fail-open + 警告）
    redis.on('error', (err) => {
      console.error('[redis] connection error, falling back to memory rate limit:', err.message)
      rateLimiter = createMemoryRateLimiter(config.externalRateLimit)
    })
  } else {
    rateLimiter = createMemoryRateLimiter(config.externalRateLimit)
  }
```

`registerExternalRoutes(app, config, pool, rateLimiter)` 传入。

- [x] **Step 6: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
```

Expected: typecheck exit 0（异步 check 后 external 路由 await 适配——apiKeyAuth 已 async ✓）。

- [x] **Step 7: 提交**

```bash
git add services/gateway/package.json services/gateway/src/config.ts services/gateway/src/rate-limit.ts services/gateway/src/routes/external.ts services/gateway/src/server.ts pnpm-lock.yaml
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(ratelimit): 可插拔限流后端（内存/Redis，异步 check）"
```

---

## Task 2: Redis 测试 + 部署

**Files:**
- Create: `services/gateway/src/rate-limit.test.ts`
- Modify: `deploy/prod/docker-compose.prod.yml`
- Create: `deploy/k8s/redis.yaml`
- Modify: `DEPLOYMENT.md`

- [x] **Step 1: rate-limit.test.ts**

创建 `services/gateway/src/rate-limit.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { createMemoryRateLimiter } from './rate-limit.js'

describe('rate limiter (memory)', () => {
  it('allows within limit and rejects over', async () => {
    const limiter = createMemoryRateLimiter(3, 60_000)
    expect((await limiter.check('k1')).allowed).toBe(true)
    expect((await limiter.check('k1')).allowed).toBe(true)
    expect((await limiter.check('k1')).allowed).toBe(true)
    const fourth = await limiter.check('k1')
    expect(fourth.allowed).toBe(false)
  })

  it('isolates keys', async () => {
    const limiter = createMemoryRateLimiter(2, 60_000)
    await limiter.check('a')
    await limiter.check('a')
    expect((await limiter.check('b')).allowed).toBe(true)
    expect((await limiter.check('a')).allowed).toBe(false)
  })

  it('resets after window', async () => {
    const limiter = createMemoryRateLimiter(1, 1000)
    await limiter.check('k')
    expect((await limiter.check('k')).allowed).toBe(false)
    await new Promise((r) => setTimeout(r, 1100))
    expect((await limiter.check('k')).allowed).toBe(true)
  })
})

// Redis 后端：本地真实 Redis 验证（REDIS_TEST=1 启用；CI 无 Redis 自动跳过）
const redisTest = process.env.REDIS_TEST === '1'
describe.skipIf(!redisTest)('rate limiter (redis)', () => {
  it('counts via redis and rejects over limit', async () => {
    const Redis = (await import('ioredis')).default
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
    try {
      const limiter = createRedisRateLimiter(redis, 2, 60)
      expect((await limiter.check('rt')).allowed).toBe(true)
      expect((await limiter.check('rt')).allowed).toBe(true)
      expect((await limiter.check('rt')).allowed).toBe(false)
    } finally {
      redis.disconnect()
    }
  })
})
```

- [x] **Step 2: compose 增 redis 服务**

读 `deploy/prod/docker-compose.prod.yml`，增：

```yaml
  redis:
    image: redis:7-alpine
    container_name: ta-prod-redis
    ports:
      - "127.0.0.1:${REDIS_PORT:-6379}:6379"
    volumes:
      - ta-prod-redis-data:/data
```

（volumes 增 `ta-prod-redis-data:`；gateway 环境变量增 `RATE_LIMIT_BACKEND`/`REDIS_URL`——`REDIS_URL: redis://redis:6379`，`RATE_LIMIT_BACKEND: ${RATE_LIMIT_BACKEND:-memory}`。）

- [x] **Step 3: K8s redis.yaml**

创建 `deploy/k8s/redis.yaml`：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: ta-prod
spec:
  selector:
    app: ta-redis
  ports:
    - port: 6379
      targetPort: 6379
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ta-redis
  namespace: ta-prod
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ta-redis
  template:
    metadata:
      labels:
        app: ta-redis
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
```

（gateway.yaml 环境变量增 RATE_LIMIT_BACKEND/REDIS_URL——install.sh 的 gateway 清单由 configmap 或 env 注入；**实现**：configmap.yaml 增 `RATE_LIMIT_BACKEND`/`REDIS_URL`，install.sh 在 gateway.yaml 应用时已含 envFrom configmap ✓——只需 configmap 加 key。）

- [x] **Step 4: DEPLOYMENT.md 更新**

DEPLOYMENT §7 安全基线限流条目更新：

```markdown
- 开放 API：X-API-Key 仅 HTTPS 传输；限流默认 60 次/分钟/key（`EXTERNAL_RATE_LIMIT` 可调）；多副本共享限流：`RATE_LIMIT_BACKEND=redis` + `REDIS_URL`（默认 memory 单副本；Redis 不可用自动降级内存）
```

- [x] **Step 5: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose src/rate-limit.test.ts
pnpm --filter @ta/gateway test --reporter=verbose
REDIS_TEST=1 pnpm --filter @ta/gateway test --reporter=verbose src/rate-limit.test.ts
```

Expected: typecheck exit 0；rate-limit.test.ts（默认跳过 redis）3 用例 PASS；全量 209 用例（206+3）全 PASS；`REDIS_TEST=1` 时 redis 用例真实跑（本地 redis-server 需起——`redis-server --daemonize yes` 或本机已有）。

- [x] **Step 6: 提交**

```bash
git add services/gateway/src/rate-limit.test.ts deploy/prod/docker-compose.prod.yml deploy/k8s/redis.yaml deploy/k8s/configmap.yaml DEPLOYMENT.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(ratelimit): Redis 后端测试 + 部署（compose/K8s redis 服务）"
```

- [x] **Step 7: 真实验收（Redis 限流）**

```bash
cd /tmp
# 1) 起 redis-server（本机）
# 2) RATE_LIMIT_BACKEND=redis EXTERNAL_RATE_LIMIT=3 起 gateway → 建 key → 连打 4 次 external → 前 3 次 200 第 4 次 429
# 3) Redis 里 rl:<user> 计数存在（redis-cli get）
```

---

## Task 3: 全仓验收 + 推送

- [x] **Step 1: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
```

Expected: build 全过；test 全绿（contracts 2 + gateway 209 + web 34 ≈ 245）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净。

- [x] **Step 2: 提交 + 推送**

```bash
git add README.md docs/superpowers/plans/2026-08-15-phase3-plan11-redis-ratelimit.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 29 全部勾选 + README 说明"
git push
```

Expected: 推送成功（CI 应绿）。

---

## Self-Review 记录

- **Spec 覆盖**：DEPLOYMENT 记录项「多副本限流（Redis）」→ 可插拔后端 + 部署；防滥用（开放 API）→ Redis 共享计数；单副本零依赖（memory 默认）。
- **占位符扫描**：无 TBD；代码逐字给出（异步 check 注已说明）。
- **类型一致性**：RateLimiter.check 异步返回在 rate-limit.ts/external 路由/测试一致；rateLimitBackend/redisUrl 在 config/server 一致。
- **已知取舍**：固定窗口（边界突发可接受）；Redis fail-open 降级内存；CI 无 Redis（skipIf 跳过，REDIS_TEST=1 本地实测）；Redis 无密码（内网，生产加固记后续）；ioredis lazyConnect。
