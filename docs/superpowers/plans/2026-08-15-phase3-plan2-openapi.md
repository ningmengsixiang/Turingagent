# Phase 3 · 计划 20：开放 API（M3.3 / FR-INT-02）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地开放 API（M3.3/FR-INT-02/BL-9）：API Key 管理（管理员生成/撤销/列表，密钥哈希存储）与外部集成端点（API Key 鉴权：外部系统向指定会话发消息、查询会话消息），支持企业内部系统（工单/财务/SSO）集成。SSO/财务/工单具体适配记 Phase 3 后续。

**Architecture:** 迁移 013 `api_keys` 表（id/key_hash/name/created_by/created_at/revoked_at，key 明文仅创建时返回一次，存 SHA-256 哈希）→ 仓储 `repos/api-keys.ts`（createApiKey/revokeApiKey/listApiKeys/verifyApiKey）→ 路由 `routes/api-keys.ts`（adminOnly：POST 生成/GET 列表/POST :id/revoke）+ `routes/external.ts`（apiKeyAuth 中间件：X-API-Key 头 → verifyApiKey → request.apiKeyUser：POST /api/v1/external/sessions/:id/messages 发消息、GET 消息列表，可见性 = 会话成员（外部系统按会话 id 定向集成））。审计：api_key.created/revoked/external.call。

**Tech Stack:** 无新依赖。crypto SHA-256 + PG + Fastify。

**质量审查决策（T1-T3 后追加）：** 通过（M1 流程收尾）。**记录建议**：maskedKey 基于哈希尾 8 位（计划代码原文——与明文无法对照识别，nit 记录，后续可另存明文尾缀列）；无 rate limiting（记后续）；X-API-Key 明文传输需生产 TLS；外部系统可冒充绑定用户发言（信任管理员设计取舍）；撤销后 401 与非成员 403 测试已补（见 T3 修复）；external GET 的 listMessages 按实际 4 参签名适配；apiKeyAuth 去 async 编译修复。

**决策记录：** API Key 存 SHA-256 哈希（明文仅生成时返回一次，防泄库即用）；key 前缀 `ta_` + 32 字节随机（crypto.randomBytes）→ base64url；外部端点可见性 = isMember（外部系统需先有会话成员身份语义——用管理员生成 key 时绑定可访问会话列表？MVP 简化：key 不限会话，调用时校验目标会话 isMember（外部调用方以 key 身份，非用户——**设计**：api_keys 增 `member_user_id`（绑定一个用户 id，外部调用以该用户身份参与会话）——外部系统以绑定用户身份发消息（senderId = 绑定用户），继承其 isMember 可见性）。撤销 = revoked_at 置 now（verify 查 revoked_at IS NULL）；key 列表脱敏（只显示前缀后 6 位 `ta_****abcd`）。SSO/财务/工单具体适配记后续（本计划提供通用端点）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `packages/contracts/src/index.ts` | 修改 | ApiKeyInfo 类型 |
| `services/gateway/migrations/013_api_keys.sql` | 创建 | api_keys 表 |
| `services/gateway/src/repos/api-keys.ts` | 创建 | key 管理仓储 |
| `services/gateway/src/routes/api-keys.ts` | 创建 | 管理端点（adminOnly） |
| `services/gateway/src/routes/external.ts` | 创建 | 外部集成端点（X-API-Key 鉴权） |
| `services/gateway/src/routes/api-keys.test.ts` | 创建 | key 管理与外部调用测试 |
| `services/gateway/src/server.ts` | 修改 | 注册路由 |
| `README.md` | 修改 | 开放 API 说明 |

---

## Task 1: 契约 + 迁移 013 + key 仓储

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `services/gateway/migrations/013_api_keys.sql`
- Create: `services/gateway/src/repos/api-keys.ts`

- [x] **Step 1: 契约**

读 `packages/contracts/src/index.ts`，文件末尾（Department 之后）追加：

```ts
export interface ApiKeyInfo {
  id: string
  /** 脱敏显示（ta_****abcd） */
  name: string
  /** 脱敏 key 尾缀 */
  maskedKey: string
  memberUserId: string
  createdAt: string
  revokedAt?: string
}
```

- [x] **Step 2: 迁移 013**

创建 `services/gateway/migrations/013_api_keys.sql`：

```sql
-- 开放 API（FR-INT-02）：API Key 管理（SHA-256 哈希存储）
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  member_user_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
```

- [x] **Step 3: 写 repos/api-keys.ts**

创建 `services/gateway/src/repos/api-keys.ts`：

```ts
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
```

- [x] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway migrate
```

Expected: 全 exit 0；013 应用。

- [x] **Step 5: 提交**

```bash
git add packages/contracts services/gateway/migrations/013_api_keys.sql services/gateway/src/repos/api-keys.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(api): 契约 ApiKeyInfo + 迁移 013 + key 仓储（SHA-256/撤销/校验）"
```

---

## Task 2: 管理端点 + 外部集成端点

**Files:**
- Create: `services/gateway/src/routes/api-keys.ts`
- Create: `services/gateway/src/routes/external.ts`
- Modify: `services/gateway/src/server.ts`

- [x] **Step 1: 写 routes/api-keys.ts**

创建 `services/gateway/src/routes/api-keys.ts`：

```ts
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { requireRoleFor } from '../middleware.js'
import { createApiKey, listApiKeys, revokeApiKey } from '../repos/api-keys.js'
import { recordAudit } from '../repos/audit.js'
import { getUserByUsername } from '../repos/users.js'
import type { Config } from '../config.js'
import pg from 'pg'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerApiKeyRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const adminOnly = requireRoleFor(config, pool)

  app.post<{ Body: { name?: string; memberUser?: string } }>(
    '/api/v1/api-keys',
    { preHandler: adminOnly },
    async (request, reply) => {
      const name = request.body?.name?.trim()
      const memberUser = request.body?.memberUser?.trim()
      if (!name || name.length > 100) {
        return reply.code(400).send({ error: 'name is required (<=100 chars)' })
      }
      if (!memberUser) return reply.code(400).send({ error: 'memberUser is required' })
      const member = await getUserByUsername(pool, memberUser)
      if (!member) return reply.code(400).send({ error: `user ${memberUser} not found` })
      const created = await createApiKey(pool, {
        name,
        memberUserId: member.userId,
        createdBy: request.user!.id,
      })
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'api_key.created',
        target: created.info.id,
        detail: { name },
      }).catch((err) => console.error('[audit] api key create failed:', err))
      return reply.code(201).send({ key: created.key, info: created.info })
    },
  )

  app.get('/api/v1/api-keys', { preHandler: adminOnly }, async () => {
    return { keys: await listApiKeys(pool) }
  })

  app.post<{ Params: { id: string } }>(
    '/api/v1/api-keys/:id/revoke',
    { preHandler: adminOnly },
    async (request, reply) => {
      const id = request.params.id
      if (!UUID_PATTERN.test(id)) return reply.code(400).send({ error: 'api key id must be a uuid' })
      const revoked = await revokeApiKey(pool, id)
      if (!revoked) return reply.code(404).send({ error: 'api key not found or already revoked' })
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'api_key.revoked',
        target: id,
        detail: { name: revoked.name },
      }).catch((err) => console.error('[audit] api key revoke failed:', err))
      return { info: revoked }
    },
  )
}
```

> 注：`getUserByUsername` 需在 repos/users.ts 存在（读现状——若无此函数，用 `SELECT user_id FROM users WHERE name = $1` 内联或新增导出；先读 users.ts）。

- [x] **Step 2: 写 routes/external.ts**

创建 `services/gateway/src/routes/external.ts`：

```ts
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { verifyApiKey } from '../repos/api-keys.js'
import { isMember } from '../repos/sessions.js'
import { createMessage, listMessages } from '../repos/messages.js'
import { recordAudit } from '../repos/audit.js'
import type { Config } from '../config.js'
import pg from 'pg'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 外部系统鉴权：X-API-Key → 绑定用户 id（挂 request.apiKeyUser） */
async function apiKeyAuth(config: Config, pool: pg.Pool) {
  return async (request: FastifyRequest, reply: { code: (n: number) => { send: (b: object) => void } }) => {
    const key = request.headers['x-api-key']
    if (typeof key !== 'string' || key.length === 0) {
      return reply.code(401).send({ error: 'X-API-Key header is required' })
    }
    const memberUserId = await verifyApiKey(pool, key)
    if (!memberUserId) {
      return reply.code(401).send({ error: 'invalid or revoked api key' })
    }
    ;(request as FastifyRequest & { apiKeyUser?: string }).apiKeyUser = memberUserId
  }
}

export function registerExternalRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const auth = apiKeyAuth(config, pool)

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
      if (!(await isMember(pool, sessionId, apiKeyUser))) {
        return reply.code(403).send({ error: 'bound user is not a member of this session' })
      }
      const { message } = await createMessage(pool, {
        sessionId,
        senderId: apiKeyUser,
        senderKind: 'human',
        contentType: 'text',
        content,
        clientMsgId: `ext-${cryptoRandomUuid()}`,
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
      if (!(await isMember(pool, sessionId, apiKeyUser))) {
        return reply.code(403).send({ error: 'bound user is not a member of this session' })
      }
      const afterSeq = Number(request.query.after_seq ?? 0)
      const { messages } = await listMessages(pool, sessionId, Number.isFinite(afterSeq) ? afterSeq : 0)
      return { messages }
    },
  )
}

function cryptoRandomUuid(): string {
  // 复用 node:crypto randomUUID（与 routes/messages.ts 同款）
  return requireUuid()
}

function requireUuid(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { randomUUID } = require('node:crypto')
  return randomUUID()
}
```

> 注：`cryptoRandomUuid` 写法笨拙——改为顶部 `import { randomUUID } from 'node:crypto'` 直接使用（实现时修正为简洁 import）。`listMessages` 的签名核对 repos/messages.ts（返回 `{ messages }` 或 `messages`——以实际为准）。

- [x] **Step 3: server.ts 注册**

读 `services/gateway/src/server.ts`，在 `registerKbRoutes(app, config, pool)` 之后增：

```ts
  registerApiKeyRoutes(app, config, pool)
  registerExternalRoutes(app, config, pool)
```

（import 增两函数。）

- [x] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
```

Expected: typecheck exit 0（若 listMessages/getUserByUsername 签名不符，读现状适配并在汇报说明）。

- [x] **Step 5: 提交**

```bash
git add services/gateway/src/routes/api-keys.ts services/gateway/src/routes/external.ts services/gateway/src/server.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(api): API Key 管理端点 + 外部集成端点（X-API-Key 鉴权）"
```

---

## Task 3: 测试 + README + 验收 + 推送

**Files:**
- Create: `services/gateway/src/routes/api-keys.test.ts`
- Modify: `README.md`
- Modify: `services/gateway/src/repos/test-helpers.ts`（truncate 增 api_keys）

- [x] **Step 1: test-helpers truncate 增 api_keys**

读 `services/gateway/src/repos/test-helpers.ts`，truncate 清单增 `api_keys`。

- [x] **Step 2: api-keys.test.ts**

创建 `services/gateway/src/routes/api-keys.test.ts`（复用既有路由测试风格）：

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('api key routes', () => {
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

  async function loginAs(username: string): Promise<string> {
    const res = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username } })
    return res.json().token as string
  }

  it('creates lists and revokes api keys', async () => {
    const admin = await loginAs('alice') // 首用户 admin
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: '工单系统', memberUser: 'alice' },
    })
    expect(created.statusCode).toBe(201)
    const key = created.json().key as string
    expect(key.startsWith('ta_')).toBe(true)

    const list = await built.app.inject({
      method: 'GET',
      url: '/api/v1/api-keys',
      headers: { authorization: `Bearer ${admin}` },
    })
    expect(list.json().keys).toHaveLength(1)
    expect(list.json().keys[0].maskedKey).toContain('****')

    const id = list.json().keys[0].id as string
    const revoked = await built.app.inject({
      method: 'POST',
      url: `/api/v1/api-keys/${id}/revoke`,
      headers: { authorization: `Bearer ${admin}` },
    })
    expect(revoked.statusCode).toBe(200)
    expect(revoked.json().info.revokedAt).toBeTruthy()
  })

  it('rejects non-admin api key management', async () => {
    const alice = await loginAs('alice')
    const bob = await loginAs('bob')
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: { authorization: `Bearer ${bob}` },
      payload: { name: 'x', memberUser: 'alice' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('external api sends and lists messages with the bound user identity', async () => {
    const admin = await loginAs('alice')
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: '工单系统', memberUser: 'alice' },
    })
    const key = created.json().key as string
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${admin}` },
      payload: { kind: 'project', title: '集成会话', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string

    const sent = await built.app.inject({
      method: 'POST',
      url: `/api/v1/external/sessions/${sessionId}/messages`,
      headers: { 'x-api-key': key },
      payload: { content: '工单 #123 已创建' },
    })
    expect(sent.statusCode).toBe(201)
    expect(sent.json().message.senderId).toBe('u-alice') // 绑定用户身份

    const listed = await built.app.inject({
      method: 'GET',
      url: `/api/v1/external/sessions/${sessionId}/messages`,
      headers: { 'x-api-key': key },
    })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().messages.some((m: { content: string }) => m.content === '工单 #123 已创建')).toBe(true)

    // 无效 key → 401
    const denied = await built.app.inject({
      method: 'GET',
      url: `/api/v1/external/sessions/${sessionId}/messages`,
      headers: { 'x-api-key': 'ta_invalid' },
    })
    expect(denied.statusCode).toBe(401)
  })
})
```

（用户 id 用既有风格 u-alice；建会话 memberIds 用 'u-bob'——先读既有测试确认。）

- [x] **Step 3: README 追加「开放 API」节**

在 README「### ABAC 数据行级权限（M3.2 / FR-PERM-02）」节之后追加：

```markdown
### 开放 API（M3.3 / FR-INT-02）

API Key 集成：管理员 `POST /api/v1/api-keys` 生成（返回明文一次，绑定成员用户，SHA-256 哈希存储）→ 外部系统带 `X-API-Key` 调用 `POST/GET /api/v1/external/sessions/:id/messages`（以绑定用户身份发消息/查消息，isMember 可见性）。撤销：`POST /api/v1/api-keys/:id/revoke`。SSO/财务/工单具体适配记后续。

```bash
# 生成 key（管理员）
curl -s -X POST localhost:3001/api/v1/api-keys -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"name":"工单系统","memberUser":"alice"}'
# 外部系统发消息
curl -s -X POST localhost:3001/api/v1/external/sessions/<sessionId>/messages \
  -H "x-api-key: ta_xxx" -H 'content-type: application/json' -d '{"content":"工单 #123 已创建"}'
```
```

- [x] **Step 4: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
```

Expected: build 全过；test 全绿（contracts 2 + gateway 178+3≈181 + web 34 ≈ 217）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净。

- [x] **Step 5: 真实验收（外部集成链路）**

```bash
cd /tmp
# 1) admin 登录 → 建会话（含 bob）→ 生成 key（绑定 alice）
# 2) 用 key 发消息 → 消息入流（senderId=alice）
# 3) 用 key 查消息 → 含刚发消息
# 4) 无效 key → 401；撤销 key 后再用 → 401
# 5) key 绑定用户非会话成员 → 403
```

- [x] **Step 6: 提交 + 推送**

```bash
git add README.md services/gateway/src/repos/test-helpers.ts services/gateway/src/routes/api-keys.test.ts docs/superpowers/plans/2026-08-15-phase3-plan2-openapi.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 20 全部勾选 + README 开放 API 说明"
git push
```

Expected: 推送成功（CI 应绿）。

---

## Self-Review 记录

- **Spec 覆盖**：FR-INT-02（与企业内部系统集成）→ API Key + 外部消息端点；BL-9 治理（admin 管理 + 审计）。SSO/财务/工单适配记后续。
- **占位符扫描**：无 TBD；代码逐字给出（external.ts 的 uuid 实现注已说明改为简洁 import）。
- **类型一致性**：`ApiKeyInfo`（id/name/maskedKey/memberUserId/createdAt/revokedAt）在契约/repo map/管理路由/测试一致；`verifyApiKey` 返回 memberUserId 在 external 路由使用一致。
- **已知取舍**：key 明文仅一次返回（哈希存储）；外部调用以绑定用户身份（isMember 可见性）；无 rate limiting（记后续）；无 SSO/工单/财务具体适配（记后续）；管理端点 adminOnly。
