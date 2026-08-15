# Phase 0 · 计划 1：Monorepo 骨架 + 共享契约 + Node/TS 网关骨架

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Turing Agent 的 pnpm monorepo 地基：`packages/contracts`（共享类型契约，唯一事实来源）与 `services/gateway`（Node/TS 网关：健康检查 + 演示登录 JWT + /me + WebSocket echo），全部带测试、可构建、可运行。

**Architecture:** pnpm workspace（`apps/*`、`services/*`、`packages/*`）；contracts 用 tsc 构建出 `lib/`，gateway 以 `workspace:*` 依赖之；网关 = Fastify 5 + @fastify/websocket + jose（HS256 JWT）；测试 = vitest（HTTP 用 `app.inject`，WS 用真实端口 + ws 客户端）。

**Tech Stack:** Node 24 + pnpm 11 + TypeScript 5（strict, NodeNext, ESM）+ Fastify 5 + jose 5 + vitest 3 + tsx 4 + ws 8。

**决策依据：** 路线图 `docs/roadmap/2026-08-15-ta-product-roadmap.md`（D1-D5 已拍板，D5 = Node/TS 全栈）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `pnpm-workspace.yaml` | 创建 | workspace 声明 |
| `package.json`（根） | 创建 | 私有根包 + 聚合脚本 |
| `tsconfig.base.json` | 创建 | 全仓共享 TS 配置 |
| `.gitignore` | 修改 | 追加 `dist/`、`coverage/`、`.env`、`*.log` |
| `packages/contracts/package.json` | 创建 | @ta/contracts |
| `packages/contracts/tsconfig.json` | 创建 | 构建配置 |
| `packages/contracts/src/index.ts` | 创建 | 核心类型 + 运行时守卫 |
| `packages/contracts/src/index.test.ts` | 创建 | 守卫测试 |
| `services/gateway/package.json` | 创建 | @ta/gateway |
| `services/gateway/tsconfig.json` | 创建 | 构建配置 |
| `services/gateway/src/config.ts` | 创建 | 环境配置 |
| `services/gateway/src/auth.ts` | 创建 | JWT 签发/校验（jose） |
| `services/gateway/src/server.ts` | 创建 | Fastify app 工厂 |
| `services/gateway/src/index.ts` | 创建 | 启动入口 |
| `services/gateway/src/routes/health.ts` | 创建 | GET /healthz |
| `services/gateway/src/routes/auth.ts` | 创建 | POST /api/v1/auth/login |
| `services/gateway/src/routes/me.ts` | 创建 | GET /api/v1/me |
| `services/gateway/src/ws.ts` | 创建 | WS /ws（鉴权 + welcome + echo） |
| `services/gateway/src/server.test.ts` | 创建 | HTTP 测试 |
| `services/gateway/src/ws.test.ts` | 创建 | WS 测试 |
| `README.md`（根） | 创建 | 快速开始 |

---

## Task 1: Monorepo 脚手架

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`（根）
- Create: `tsconfig.base.json`
- Modify: `.gitignore`

- [ ] **Step 1: 写 pnpm-workspace.yaml**

```yaml
packages:
  - apps/*
  - services/*
  - packages/*
```

- [ ] **Step 2: 写根 package.json**

```json
{
  "name": "turing-agent",
  "private": true,
  "packageManager": "pnpm@11.7.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r build && pnpm -r test",
    "dev:gateway": "pnpm --filter @ta/gateway dev"
  }
}
```

- [ ] **Step 3: 写 tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Step 4: 追加 .gitignore**

Append（`/Users/wanzichanpinjingli/Desktop/TuringAgent/.gitignore` 末尾）：

```
dist/
coverage/
.env
*.log
```

- [ ] **Step 5: 验证 + 提交**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm install    # 空 workspace，应快速成功
git add pnpm-workspace.yaml package.json tsconfig.base.json .gitignore
git commit -m "chore: monorepo 脚手架（pnpm workspace + 根配置）"
```

Expected: `pnpm install` 成功（无包可装也正常）；commit 成功。

---

## Task 2: packages/contracts 共享契约

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/index.test.ts`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "@ta/contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": { ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: 写 tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "lib",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 写 src/index.ts（核心类型 + 运行时守卫）**

```ts
/** 消息内容类型（契约唯一事实来源，TechDesign：packages/contracts 是协议唯一事实来源） */
export const MessageContentType = {
  Text: 'text',
  File: 'file',
  ConfirmationCard: 'confirmation_card',
  TaskCard: 'task_card',
} as const
export type MessageContentType = (typeof MessageContentType)[keyof typeof MessageContentType]

export const isMessageContentType = (v: unknown): v is MessageContentType =>
  typeof v === 'string' && (Object.values(MessageContentType) as string[]).includes(v)

export interface User {
  id: string
  name: string
  avatar?: string
  role: 'human' | 'agent'
  agentRole?: 'ta-pm' | 'ta-architect' | 'ta-fullstack' | 'ta-qa'
}

export interface Session {
  id: string
  kind: 'direct' | 'project' | 'group'
  title: string
  memberIds: string[]
}

export interface Message {
  id: string
  sessionId: string
  senderId: string
  senderKind: 'human' | 'agent'
  contentType: MessageContentType
  content: string
  seq: number
  createdAt: string
}

export const ApprovalStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
} as const
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus]

export interface Approval {
  id: string
  title: string
  status: ApprovalStatus
  approverId: string
  reason?: string
  createdAt: string
  decidedAt?: string
}

export const TaskStatus = {
  Todo: 'todo',
  InProgress: 'in_progress',
  Blocked: 'blocked',
  Done: 'done',
} as const
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus]

export interface Task {
  id: string
  sessionId: string
  title: string
  assigneeId: string
  assigneeKind: 'human' | 'agent'
  status: TaskStatus
  dueAt?: string
}
```

- [ ] **Step 4: 写 src/index.test.ts**

```ts
import { describe, expect, it } from 'vitest'
import { isMessageContentType, MessageContentType } from './index.js'

describe('contracts', () => {
  it('accepts known message content types', () => {
    expect(isMessageContentType('text')).toBe(true)
    expect(isMessageContentType(MessageContentType.ConfirmationCard)).toBe(true)
    expect(isMessageContentType(MessageContentType.TaskCard)).toBe(true)
  })

  it('rejects unknown values', () => {
    expect(isMessageContentType('carrier-pigeon')).toBe(false)
    expect(isMessageContentType(42)).toBe(false)
    expect(isMessageContentType(undefined)).toBe(false)
  })
})
```

- [ ] **Step 5: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm install
pnpm --filter @ta/contracts build
pnpm --filter @ta/contracts test
```

Expected: build 产出 `packages/contracts/lib/index.js` + `.d.ts`；vitest 3 个用例全 PASS。

- [ ] **Step 5b: lockfile 入库（质量审查硬性要求）**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
git add pnpm-lock.yaml
pnpm install --frozen-lockfile   # 一致性校验：应成功
```

Expected: `pnpm-lock.yaml` 已生成并加入暂存；`--frozen-lockfile` 无版本漂移报错。lockfile 与 contracts 一起在 Step 6 提交（把 `pnpm-lock.yaml` 加进 Step 6 的 `git add` 列表）。

- [ ] **Step 6: 提交**

```bash
git add packages/contracts pnpm-lock.yaml
git commit -m "feat(contracts): 核心类型与消息内容类型守卫"
```

---

## Task 3: 网关 HTTP（health / login / me）

**Files:**
- Create: `services/gateway/package.json`
- Create: `services/gateway/tsconfig.json`
- Create: `services/gateway/src/config.ts`
- Create: `services/gateway/src/auth.ts`
- Create: `services/gateway/src/server.ts`
- Create: `services/gateway/src/index.ts`
- Create: `services/gateway/src/routes/health.ts`
- Create: `services/gateway/src/routes/auth.ts`
- Create: `services/gateway/src/routes/me.ts`
- Create: `services/gateway/src/server.test.ts`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "@ta/gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsx watch src/index.ts",
    "start": "node lib/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@fastify/websocket": "^11.0.2",
    "@ta/contracts": "workspace:*",
    "fastify": "^5.2.1",
    "jose": "^5.9.6"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^3.2.4",
    "ws": "^8.18.0"
  }
}
```

> **仓库约定（T2 质量审查确立）**：每个包 build 用 `tsconfig.build.json`（排除 `src/**/*.test.ts`，测试不进 lib 产物），配 `vitest.config.ts`（`include: ['src/**/*.test.ts']`）防止 vitest 双拾取构建产物；`typecheck` 仍用主 tsconfig 覆盖测试文件的类型检查。

- [ ] **Step 2: 写 tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "lib",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 2b: 写 tsconfig.build.json（仓库约定：排除测试）**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 2c: 写 vitest.config.ts（仓库约定：只拾取 src 测试）**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: 写 src/config.ts**

```ts
export interface Config {
  port: number
  jwtSecret: string
  jwtExpiresIn: string
}

const DEV_SECRET = 'dev-secret-do-not-use-in-prod'

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = env.JWT_SECRET ?? DEV_SECRET
  if (env.NODE_ENV === 'production' && jwtSecret === DEV_SECRET) {
    throw new Error('JWT_SECRET must be set in production')
  }
  return {
    port: Number(env.PORT ?? 3001),
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? '7d',
  }
}
```

- [ ] **Step 4: 写 src/auth.ts**

```ts
import { jwtVerify, SignJWT } from 'jose'
import type { Config } from './config.js'

export interface JwtUser {
  id: string
  name: string
}

export async function signToken(user: JwtUser, config: Config): Promise<string> {
  const secret = new TextEncoder().encode(config.jwtSecret)
  return new SignJWT({ name: user.name })
    .setSubject(user.id)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.jwtExpiresIn)
    .sign(secret)
}

export async function verifyToken(token: string, config: Config): Promise<JwtUser | null> {
  try {
    const secret = new TextEncoder().encode(config.jwtSecret)
    const { payload } = await jwtVerify(token, secret)
    if (typeof payload.sub !== 'string' || typeof payload.name !== 'string') return null
    return { id: payload.sub, name: payload.name }
  } catch {
    return null
  }
}
```

- [ ] **Step 5: 写 src/routes/health.ts**

```ts
import type { FastifyInstance } from 'fastify'

export function registerHealth(app: FastifyInstance): void {
  app.get('/healthz', async () => ({ status: 'ok' }))
}
```

- [ ] **Step 6: 写 src/routes/auth.ts**

```ts
import type { FastifyInstance } from 'fastify'
import { signToken } from '../auth.js'
import type { Config } from '../config.js'

interface LoginBody {
  username?: string
}

export function registerAuth(app: FastifyInstance, config: Config): void {
  app.post<{ Body: LoginBody }>('/api/v1/auth/login', async (request, reply) => {
    const username = request.body?.username?.trim()
    if (!username) {
      return reply.code(400).send({ error: 'username is required' })
    }
    const user = { id: `u-${username}`, name: username }
    const token = await signToken(user, config)
    return { token, user }
  })
}
```

- [ ] **Step 7: 写 src/routes/me.ts**

```ts
import type { FastifyInstance } from 'fastify'
import { verifyToken } from '../auth.js'
import type { Config } from '../config.js'

export function registerMe(app: FastifyInstance, config: Config): void {
  app.get('/api/v1/me', async (request, reply) => {
    const header = request.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
    if (!token) return reply.code(401).send({ error: 'missing bearer token' })
    const user = await verifyToken(token, config)
    if (!user) return reply.code(401).send({ error: 'invalid token' })
    return { user }
  })
}
```

- [ ] **Step 8: 写 src/server.ts（app 工厂）**

```ts
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { loadConfig, type Config } from './config.js'
import { registerHealth } from './routes/health.js'
import { registerAuth } from './routes/auth.js'
import { registerMe } from './routes/me.js'
import { registerWs } from './ws.js'

export interface BuiltApp {
  app: ReturnType<typeof Fastify>
  config: Config
}

export async function buildApp(overrides?: Partial<Config>): Promise<BuiltApp> {
  const config = { ...loadConfig(), ...overrides }
  const app = Fastify({ logger: false })
  await app.register(websocket)
  registerHealth(app)
  registerAuth(app, config)
  registerMe(app, config)
  registerWs(app, config)
  return { app, config }
}
```

- [ ] **Step 9: 写 src/index.ts（启动入口）**

```ts
import { buildApp } from './server.js'

const { app, config } = await buildApp()
try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`gateway listening on http://0.0.0.0:${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
```

- [ ] **Step 10: 写 src/server.test.ts**

```ts
import { describe, expect, it } from 'vitest'
import { buildApp } from './server.js'

describe('gateway http', () => {
  it('GET /healthz returns ok', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
    await app.close()
  })

  it('login requires username', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: {} })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('login returns token and user', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(typeof body.token).toBe('string')
    expect(body.user.name).toBe('alice')
    await app.close()
  })

  it('GET /me requires token', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('GET /me returns user with valid token', async () => {
    const { app } = await buildApp()
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob' } })
    const { token } = login.json()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.name).toBe('bob')
    await app.close()
  })

  it('GET /me rejects invalid token', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: 'Bearer not-a-jwt' } })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
```

- [ ] **Step 11: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm install
pnpm --filter @ta/gateway test
```

Expected: 6 个 HTTP 用例全 PASS（注意：`registerWs` 依赖的 `src/ws.ts` 由 Task 4 提供——本 Task 需要先放一个**最小占位** `src/ws.ts`（空函数体），Task 4 再替换为完整实现）。

- [ ] **Step 12: 提交**

```bash
git add services/gateway
git commit -m "feat(gateway): HTTP 骨架（healthz / 演示登录 JWT / me）"
```

---

## Task 4: WS echo + 根 README + 收尾推送

**Files:**
- Create: `services/gateway/src/ws.ts`（完整实现，替换 Task 3 占位）
- Create: `services/gateway/src/ws.test.ts`
- Create: `README.md`（根）

- [ ] **Step 1: 写 src/ws.ts（完整实现）**

```ts
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { verifyToken } from './auth.js'
import type { Config } from './config.js'

const OPEN = 1

export function registerWs(app: FastifyInstance, config: Config): void {
  app.get('/ws', { websocket: true }, (socket: WebSocket, request) => {
    const token = (request.query as { token?: string }).token
    // 消息监听必须在鉴权 await 之前挂载：窗口期到达的客户端消息不能丢（竞态修复）
    let authed = false
    socket.on('message', (raw) => {
      if (!authed || socket.readyState !== OPEN) return
      socket.send(JSON.stringify({ type: 'echo', data: raw.toString() }))
    })
    void (async () => {
      const user = token ? await verifyToken(token, config) : null
      if (!user) {
        socket.close(4401, 'unauthorized')
        return
      }
      authed = true
      if (socket.readyState === OPEN) {
        socket.send(JSON.stringify({ type: 'welcome', user: { id: user.id, name: user.name } }))
      }
    })()
  })
}
```

> 注：`@types/ws` 已加入 gateway devDependencies（Task 3 Step 1），供 `import type { WebSocket } from 'ws'` 使用。

- [ ] **Step 2: 写 src/ws.test.ts**

```ts
import { describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'
import { buildApp } from './server.js'

const open = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })

function waitFor(ws: WebSocket, count: number, received: string[]): Promise<void> {
  return new Promise((resolve) => {
    const onMsg = (data: WebSocket.RawData) => {
      received.push(data.toString())
      if (received.length >= count) {
        ws.off('message', onMsg)
        resolve()
      }
    }
    ws.on('message', onMsg)
  })
}

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (address === null || typeof address === 'string') throw new Error('unexpected address')
  return address.port
}

describe('gateway websocket', () => {
  it('rejects connection without a valid token (close 4401)', async () => {
    const { app } = await buildApp()
    const port = await listen(app)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=bad`)
    const close = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }))
      ws.on('error', reject)
    })
    expect(close.code).toBe(4401)
    await app.close()
  })

  it('welcomes then echoes after valid token', async () => {
    const { app } = await buildApp()
    const port = await listen(app)
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'carol' } })
    const token = login.json().token
    const ws = await open(`ws://127.0.0.1:${port}/ws?token=${token}`)
    const received: string[] = []
    await waitFor(ws, 1, received)
    ws.send('hello')
    await waitFor(ws, 2, received)
    expect(JSON.parse(received[0] as string).type).toBe('welcome')
    expect(JSON.parse(received[1] as string)).toEqual({ type: 'echo', data: 'hello' })
    ws.close()
    await app.close()
  })
})
```

> 注：`buildApp` 返回的 `{ app, config }` 中的 `app` 即 FastifyInstance，测试直接传入 `listen(app)` 即可。

- [ ] **Step 3: 写根 README.md**

```markdown
# Turing Agent（Ta）

企业 IM 聊天软件 + 内置智能体团队（Ta-PM / Ta-Architect / Ta-Fullstack / Ta-QA），专注软件开发「需求 → 澄清 → 评审 → 交付 → 验收」全流程。

- PRD：`TuringAgent.md` ｜ 技术方案：`TechDesign.md` ｜ 路线图：`docs/roadmap/`
- 交互原型：`prototype-static/`（浏览器直接打开）
- 产品文档与设计：`docs/`

## 开发

```bash
pnpm install        # 安装全部 workspace
pnpm build          # 构建全部包（contracts → gateway）
pnpm test           # 全仓测试
pnpm dev:gateway    # 启动网关开发服务器（默认 :3001）
```

### 网关冒烟

```bash
curl localhost:3001/healthz
# {"status":"ok"}

curl -X POST localhost:3001/api/v1/auth/login -H 'content-type: application/json' -d '{"username":"alice"}'
# {"token":"<jwt>","user":{"id":"u-alice","name":"alice"}}

# WebSocket（token 从登录响应取）
# ws://localhost:3001/ws?token=<jwt>  → welcome → echo
```

## 结构

```
packages/contracts   共享类型契约（唯一事实来源）
services/gateway     网关：认证 / 健康检查 / WS
apps/                客户端（Phase 0 计划 4 落地）
```
```

- [ ] **Step 4: 验证全仓**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm install
pnpm build
pnpm test
```

Expected: contracts 与 gateway 全部构建成功；contracts 3 用例 + gateway 8 用例（6 HTTP + 2 WS）全 PASS。

- [ ] **Step 5: 提交 + 推送**

```bash
git add services/gateway README.md
git commit -m "feat(gateway): WS echo 鉴权 + 根 README"
git push
```

Expected: 推送成功，`origin/main` 更新。

---

## Self-Review 记录（写完后自查）

- **Spec 覆盖**：路线图 M0.1（仓库+契约）→ Task 1/2；M0.2（后端骨架：认证/健康检查）→ Task 3；WS 推送雏形 → Task 4；README → Task 4。
- **占位符扫描**：无 TBD；Task 3 的 `ws.ts` 占位是**有意的执行顺序占位**，Task 4 完整替换，计划已注明。
- **类型一致性**：`buildApp` 返回 `{app, config}` 在 Task 3/4 测试中一致；`signToken`/`verifyToken` 签名在 auth.ts/route/ws 中一致；`Config` 字段 `port/jwtSecret/jwtExpiresIn` 全程一致。
- **环境事实**：Node 24 / pnpm 11 / Docker 28 已确认；Go 未安装（D5 已改判 Node/TS）。

## 决策记录（T2 质量审查后）

1. **pnpm allowBuilds**：根 `pnpm-workspace.yaml` 写 `allowBuilds: { esbuild: true }`（pnpm 11 语法，实测有效；pnpm 10 的 `onlyBuiltDependencies` 在 11 已被改名，勿用）——否则全新克隆 `pnpm install --frozen-lockfile` 直接失败（esbuild postinstall 被拒）。
2. **测试排除约定（全仓）**：每包 `tsconfig.build.json`（extends 主配置 + `exclude: ["src/**/*.test.ts"]`）供 build 使用；`vitest.config.ts` 限定 `include: ['src/**/*.test.ts']`；`typecheck` 用主 tsconfig 保留测试文件的类型检查。contracts 为范例，gateway 照抄（Task 3 Step 2b/2c）。
3. **契约完备度（延后项，Plan 2 落地）**：WS 事件联合（message.new/updated、approval.created/decided 等）、错误码枚举、API DTO 与分页（after_seq）、结构化卡片负载（content 按 contentType 联合）——在 Plan 2（消息引擎 + WS 推送）消费契约前补齐，本计划只做低价高价值项：`MessageContentType` 增 System/Image/Voice、`Message` 增 `clientMsgId`/`updatedAt`/`ref`、`Approval` 增 `sessionId`、提取 `ActorKind`。
