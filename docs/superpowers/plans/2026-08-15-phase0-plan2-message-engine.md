# Phase 0 · 计划 2：IM 消息引擎核心

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `services/gateway` 中落地 IM 消息引擎核心：会话（创建/列表）、消息（seq 有序、`clientMsgId` 幂等、`after_seq` 分页）、已读回执、WebSocket 实时推送（`message.new` 广播给会话成员）。数据持久化到 PostgreSQL 16（Docker Compose 起步）。

**Architecture:** 三层：`db.ts`（pg Pool 工厂）+ `repos/`（会话/消息仓储，事务保证 seq 单调与幂等）+ `routes/`（REST，`requireAuth` 前置守卫 + 成员校验）+ `registry.ts`（WS 连接注册表，消息创建后经 `events.ts` 事件总线广播 `message.new`）。契约补 `WsEvent` 联合（决策记录 #3 的延后项在 Plan 2 落地）。

**Tech Stack:** Node 24 + Fastify 5 + `pg`（node-postgres 8，自带 TS 类型）+ PostgreSQL 16（docker）+ 自定义 SQL 迁移 runner（tsx 执行）+ vitest 集成测试（真实 PG）。

**前置条件：** 本地 PostgreSQL 16。本机 colima（macOS 虚拟化）已运行，Docker daemon 可用：`docker compose -f deploy/docker-compose.yml up -d` 拉起开发库。若 Docker 不可用，备选 Homebrew 本地 PG（连接串相同：`postgres://ta:ta@localhost:5432/ta_dev`）。

### 本地 PG 初始化（一次性）

```bash
docker compose -f deploy/docker-compose.yml up -d   # postgres:16-alpine，自动建 ta/ta_dev
# 备选（Docker 不可用时）：brew install postgresql@16 && brew services start postgresql@16
#   /opt/homebrew/opt/postgresql@16/bin/psql -d postgres -c "CREATE ROLE ta WITH LOGIN PASSWORD 'ta'"
#   /opt/homebrew/opt/postgresql@16/bin/psql -d postgres -c "CREATE DATABASE ta_dev OWNER ta"
# 验证
docker exec ta-db pg_isready -U ta -d ta_dev
```

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `deploy/docker-compose.yml` | 创建 | postgres:16 开发库（ta_dev） |
| `services/gateway/src/config.ts` | 修改 | 增 `databaseUrl` 字段与生产校验 |
| `services/gateway/src/db.ts` | 创建 | pg Pool 工厂（按 config 创建） |
| `services/gateway/migrations/001_init.sql` | 创建 | sessions / session_members / messages 表 |
| `services/gateway/scripts/migrate.ts` | 创建 | 顺序执行 migrations/*.sql + schema_migrations 记账 |
| `services/gateway/src/events.ts` | 创建 | 进程内事件总线（message.created） |
| `services/gateway/src/registry.ts` | 创建 | WS 连接注册表（userId→sockets、sessionId→sockets） |
| `services/gateway/src/repos/sessions.ts` | 创建 | 会话仓储（创建/列表/成员/已读） |
| `services/gateway/src/repos/messages.ts` | 创建 | 消息仓储（发送幂等/列表/seq 事务） |
| `services/gateway/src/middleware.ts` | 创建 | `requireAuth` preHandler + FastifyRequest.user 类型扩展 |
| `services/gateway/src/routes/sessions.ts` | 创建 | POST/GET /api/v1/sessions |
| `services/gateway/src/routes/messages.ts` | 创建 | GET/POST messages、POST read |
| `services/gateway/src/ws.ts` | 修改 | 鉴权→加载成员→注册表→welcome/echo + 订阅 message.created 广播 |
| `services/gateway/src/server.ts` | 修改 | buildApp 创建 pool/registry/events，onClose 释放 |
| `services/gateway/package.json` | 修改 | 增 `migrate` 脚本 + `pg` 依赖 |
| `packages/contracts/src/index.ts` | 修改 | 增 `WsEvent` 联合（message.new） |
| 测试文件 | 创建 | repos/sessions.test.ts、repos/messages.test.ts、routes/sessions.test.ts、routes/messages.test.ts、ws-push.test.ts |

**测试约定：** 集成测试连真实 PG（`ta_dev` 库），`beforeEach` TRUNCATE 相关表；PG 未启动时 fail fast 并提示 `docker compose -f deploy/docker-compose.yml up -d`。

---

## Task 1: DB 基建（compose + 配置 + 迁移）

**Files:**
- Create: `deploy/docker-compose.yml`
- Modify: `services/gateway/src/config.ts`
- Create: `services/gateway/src/db.ts`
- Create: `services/gateway/migrations/001_init.sql`
- Create: `services/gateway/src/migrate.ts`（迁移 runner；位于 src/ 内以纳入 typecheck/build，T2 阻塞点修正）
- Modify: `services/gateway/package.json`

- [ ] **Step 1: 写 deploy/docker-compose.yml**

```yaml
services:
  db:
    image: postgres:16-alpine
    container_name: ta-db
    environment:
      POSTGRES_USER: ta
      POSTGRES_PASSWORD: ta
      POSTGRES_DB: ta_dev
    ports:
      - "5432:5432"
    volumes:
      - ta-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ta -d ta_dev"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  ta-pgdata:
```

- [ ] **Step 2: 修改 src/config.ts（用 edit 替换整个文件）**

```ts
export interface Config {
  port: number
  jwtSecret: string
  jwtExpiresIn: string
  databaseUrl: string
}

const DEV_SECRET = 'dev-secret-do-not-use-in-prod'
const MIN_SECRET_LENGTH = 32
const DEV_DATABASE_URL = 'postgres://ta:ta@localhost:5432/ta_dev'

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = env.JWT_SECRET ?? DEV_SECRET
  const envName = env.NODE_ENV ?? '(unset)'
  const isDev = envName === 'development' || envName === 'test'
  if (!isDev && (jwtSecret === DEV_SECRET || jwtSecret.length < MIN_SECRET_LENGTH)) {
    throw new Error(
      `JWT_SECRET must be a strong secret (>=${MIN_SECRET_LENGTH} chars) in non-development environments (NODE_ENV=${envName}); for local dev set NODE_ENV=development`,
    )
  }
  const port = Number(env.PORT ?? 3001)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer in [1, 65535], got: ${env.PORT}`)
  }
  const databaseUrl = env.DATABASE_URL ?? DEV_DATABASE_URL
  if (!isDev && databaseUrl === DEV_DATABASE_URL) {
    throw new Error(`DATABASE_URL must be set in non-development environments (NODE_ENV=${envName})`)
  }
  return {
    port,
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? '7d',
    databaseUrl,
  }
}
```

- [ ] **Step 3: 写 src/db.ts**

```ts
import pg from 'pg'

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 })
}
```

- [ ] **Step 4: 写 migrations/001_init.sql**

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'project', 'group')),
  title TEXT NOT NULL,
  last_seq BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_members (
  session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  last_read_seq BIGINT NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('human', 'agent')),
  content_type TEXT NOT NULL,
  content TEXT NOT NULL,
  client_msg_id TEXT NOT NULL,
  seq BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq),
  UNIQUE (sender_id, client_msg_id)
);

CREATE INDEX IF NOT EXISTS idx_session_members_user ON session_members (user_id);
```
> 注：`(session_id, seq)` 的 UNIQUE 约束已自带索引，不再显式建 `idx_messages_session_seq`（冗余，质量审查结论）；`session_members.user_id` 单列索引服务 `listSessionsForUser` 反前缀查询（Important 修复）。001 若已在 dev 库应用，改动需对现库手工收敛（`CREATE INDEX IF NOT EXISTS idx_session_members_user ON session_members (user_id);`），001 本身为全新环境保持正确。

- [ ] **Step 5: 写 src/migrate.ts（迁移 runner，位于 src/ 内）**

> **位置说明（T2 阻塞点修正）**：runner 在 `src/` 而非 `scripts/`——`repos/test-helpers.ts` 需 import `runMigrations`，放 `scripts/` 会触发 tsc TS6059（rootDir=src 越界）。放 `src/` 后同时纳入 typecheck/build；`lib/migrate.js` 的 `..` 仍指向 gateway 根，`migrations/` 运行时解析正确，生产可从构建产物跑迁移。migrate 脚本为 `tsx src/migrate.ts`。

```ts
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const MIGRATION_LOCK_KEY = 726827367

export async function runMigrations(pool: pg.Pool): Promise<string[]> {
  // 并发 runner 串行化：双进程同时迁移时败者不再因记账 23505 崩溃
  await pool.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
    const applied = new Set(
      (await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string),
    )
    const ran: string[] = []
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        ran.push(file)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    }
    return ran
  } finally {
    await pool.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
  }
}

const isCli = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href

if (isCli) {
  const url = process.env.DATABASE_URL ?? 'postgres://ta:ta@localhost:5432/ta_dev'
  const pool = new pg.Pool({ connectionString: url })
  const ran = await runMigrations(pool)
  console.log(ran.length === 0 ? 'migrations: up to date' : `migrations applied: ${ran.join(', ')}`)
  await pool.end()
}
```

> **迁移说明（从 scripts/ 迁移至 src/，T2 阻塞点）**：已提交的 `scripts/migrate.ts`（提交 0b3937a 参数化锁版）整体移动到 `src/migrate.ts`；`package.json` migrate 脚本改为 `tsx src/migrate.ts`；`repos/test-helpers.ts` 的导入改为 `../migrate.js`。删除旧的 `scripts/` 目录。

- [ ] **Step 6: 修改 package.json（services/gateway）**

dependencies 增 `"pg": "^8.13.1"`（在 `"jose"` 之后）；devDependencies 增 `"@types/pg": "^8.11.10"`（pg 不自带类型声明，TS7016 需要）；scripts 增 `"migrate": "tsx src/migrate.ts"`。

- [ ] **Step 6b: 修正既有 config 测试（DATABASE_URL 新守卫影响）**

`src/config.test.ts` 的「accepts strong secret outside test/development」用例必须显式传 `DATABASE_URL`（否则新的非 dev 环境 DATABASE_URL 守卫先抛错），并新增 DATABASE_URL 守卫用例（质量审查补充）：
```ts
  it('accepts strong secret outside test/development', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(40),
      DATABASE_URL: 'postgres://prod:prod@db:5432/ta_prod',
    })
    expect(config.jwtSecret).toHaveLength(40)
  })

  it('rejects missing or dev DATABASE_URL outside test/development', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) })).toThrow(/DATABASE_URL/)
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(40),
        DATABASE_URL: 'postgres://ta:ta@localhost:5432/ta_dev',
      }),
    ).toThrow(/DATABASE_URL/)
  })

  it('accepts dev DATABASE_URL in development', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).databaseUrl).toBe('postgres://ta:ta@localhost:5432/ta_dev')
  })
```

- [ ] **Step 7: 启动 PG 并验证迁移**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml up -d
sleep 3
docker compose -f deploy/docker-compose.yml ps   # db 应 healthy
pnpm install
pnpm --filter @ta/gateway migrate
docker exec ta-db psql -U ta -d ta_dev -c '\dt'
```

Expected: 迁移输出 `migrations applied: 001_init.sql`；`\dt` 显示 sessions / session_members / messages / schema_migrations 四张表。

- [ ] **Step 8: 提交**

```bash
git add deploy services/gateway pnpm-lock.yaml
git commit -m "feat(gateway): DB 基建（PG compose/配置/迁移 runner）"
```

---

## Task 2: 仓储层（会话 + 消息 + 已读）

**Files:**
- Create: `services/gateway/src/repos/sessions.ts`
- Create: `services/gateway/src/repos/messages.ts`
- Create: `services/gateway/src/repos/sessions.test.ts`
- Create: `services/gateway/src/repos/messages.test.ts`
- Create: `services/gateway/src/repos/test-helpers.ts`

- [ ] **Step 1: 写 test-helpers.ts（测试共用：迁移 + 清库 + 建池）**

```ts
import pg from 'pg'
import { runMigrations } from '../migrate.js'

export const TEST_DATABASE_URL = 'postgres://ta:ta@localhost:5432/ta_dev'

export async function createTestPool(): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 5 })
  await runMigrations(pool)
  return pool
}

export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query('TRUNCATE messages, session_members, sessions RESTART IDENTITY CASCADE')
}
```

> **vitest 串行化（T2 阻塞点修正）**：`services/gateway/vitest.config.ts` 必须加 `fileParallelism: false`——多个集成测试文件共享 `ta_dev` 库，各自 `beforeEach` TRUNCATE 会互相清数据（并行竞态实测失败）。文件级串行后仓储/路由/WS 集成测试确定可过。

- [ ] **Step 2: 写 repos/sessions.ts**

```ts
import pg from 'pg'
import type { Session } from '@ta/contracts'

export interface SessionWithUnread extends Session {
  unreadCount: number
}

export interface SessionRow {
  id: string
  kind: 'direct' | 'project' | 'group'
  title: string
  last_seq: string
  created_at: Date
}

function mapSession(row: SessionRow): Session {
  return { id: row.id, kind: row.kind, title: row.title, memberIds: [] }
}

export async function createSession(
  pool: pg.Pool,
  input: { kind: 'direct' | 'project' | 'group'; title: string; memberIds: string[] },
): Promise<Session> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const res = await client.query<SessionRow>(
      'INSERT INTO sessions (kind, title) VALUES ($1, $2) RETURNING *',
      [input.kind, input.title],
    )
    const session = mapSession(res.rows[0]!)
    const members = [...new Set([...input.memberIds])]
    for (const userId of members) {
      await client.query('INSERT INTO session_members (session_id, user_id) VALUES ($1, $2)', [
        session.id,
        userId,
      ])
    }
    await client.query('COMMIT')
    return { ...session, memberIds: members }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function listSessionsForUser(pool: pg.Pool, userId: string): Promise<SessionWithUnread[]> {
  const res = await pool.query<{
    id: string
    kind: 'direct' | 'project' | 'group'
    title: string
    unread: string
  }>(
    `SELECT s.id, s.kind, s.title,
            (SELECT count(*) FROM messages m
              WHERE m.session_id = s.id
                AND m.seq > sm.last_read_seq
                AND m.sender_id <> $1)::text AS unread
       FROM session_members sm
       JOIN sessions s ON s.id = sm.session_id
      WHERE sm.user_id = $1
      ORDER BY s.created_at DESC`,
    [userId],
  )
  return res.rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    memberIds: [],
    unreadCount: Number(r.unread),
  }))
}

export async function isMember(pool: pg.Pool, sessionId: string, userId: string): Promise<boolean> {
  const res = await pool.query('SELECT 1 FROM session_members WHERE session_id = $1 AND user_id = $2', [
    sessionId,
    userId,
  ])
  return res.rowCount !== null && res.rowCount > 0
}

export async function getSessionById(pool: pg.Pool, sessionId: string): Promise<Session | null> {
  const res = await pool.query<SessionRow>('SELECT * FROM sessions WHERE id = $1', [sessionId])
  if (!res.rows[0]) return null
  return mapSession(res.rows[0])
}

export async function listSessionIdsForUser(pool: pg.Pool, userId: string): Promise<string[]> {
  const res = await pool.query('SELECT session_id FROM session_members WHERE user_id = $1', [userId])
  return res.rows.map((r) => r.session_id as string)
}

export async function markRead(
  pool: pg.Pool,
  sessionId: string,
  userId: string,
  seq: number,
): Promise<void> {
  await pool.query(
    `UPDATE session_members SET last_read_seq = GREATEST(last_read_seq, $3)
      WHERE session_id = $1 AND user_id = $2`,
    [sessionId, userId, seq],
  )
}
```

- [ ] **Step 3: 写 repos/messages.ts**

```ts
import pg from 'pg'
import type { ActorKind, Message, MessageContentType } from '@ta/contracts'
import { isMessageContentType } from '@ta/contracts'

export interface MessageRow {
  id: string
  session_id: string
  sender_id: string
  sender_kind: string
  content_type: string
  content: string
  client_msg_id: string
  seq: string
  created_at: Date
}

export function mapMessage(row: MessageRow): Message {
  const contentType: MessageContentType = isMessageContentType(row.content_type)
    ? row.content_type
    : 'text'
  return {
    id: row.id,
    clientMsgId: row.client_msg_id,
    sessionId: row.session_id,
    senderId: row.sender_id,
    senderKind: row.sender_kind as ActorKind,
    contentType,
    content: row.content,
    seq: Number(row.seq),
    createdAt: row.created_at.toISOString(),
  }
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint?: string }
  return e.code === '23505' && e.constraint === constraint
}

export async function createMessage(
  pool: pg.Pool,
  input: {
    sessionId: string
    senderId: string
    senderKind: ActorKind
    contentType: MessageContentType
    content: string
    clientMsgId: string
  },
): Promise<{ message: Message; created: boolean }> {
  const existing = await pool.query<MessageRow>(
    'SELECT * FROM messages WHERE sender_id = $1 AND client_msg_id = $2',
    [input.senderId, input.clientMsgId],
  )
  if (existing.rows[0]) return { message: mapMessage(existing.rows[0]), created: false }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const seqRes = await client.query<{ last_seq: string }>(
      'UPDATE sessions SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq',
      [input.sessionId],
    )
    if (!seqRes.rows[0]) throw new Error(`session not found: ${input.sessionId}`)
    const seq = Number(seqRes.rows[0].last_seq)
    const ins = await client.query<MessageRow>(
      `INSERT INTO messages (session_id, sender_id, sender_kind, content_type, content, client_msg_id, seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [input.sessionId, input.senderId, input.senderKind, input.contentType, input.content, input.clientMsgId, seq],
    )
    await client.query('COMMIT')
    return { message: mapMessage(ins.rows[0]!), created: true }
  } catch (err) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(err, 'messages_sender_id_client_msg_id_key')) {
      // 必须在同一 client 上回查（Blocker 修复）：此时 client 已 ROLLBACK 空闲；
      // 若用 pool.query 借新连接，并发重复发送 ≥ 池上限时会池自死锁
      const dup = await client.query<MessageRow>(
        'SELECT * FROM messages WHERE sender_id = $1 AND client_msg_id = $2',
        [input.senderId, input.clientMsgId],
      )
      if (dup.rows[0]) return { message: mapMessage(dup.rows[0]), created: false }
    }
    throw err
  } finally {
    client.release()
  }
}

export async function listMessages(
  pool: pg.Pool,
  sessionId: string,
  afterSeq: number,
  limit: number,
): Promise<Message[]> {
  const res = await pool.query<MessageRow>(
    `SELECT * FROM messages WHERE session_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3`,
    [sessionId, afterSeq, limit],
  )
  return res.rows.map(mapMessage)
}
```

- [ ] **Step 4: 写 repos/sessions.test.ts**

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from './test-helpers.js'
import { createSession, isMember, listSessionsForUser, markRead } from './sessions.js'
import { createMessage } from './messages.js'

describe('session repository', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
  })

  it('creates a session with deduped members', async () => {
    const session = await createSession(pool, {
      kind: 'project',
      title: '报销系统',
      memberIds: ['u-alice', 'u-bob', 'u-alice'],
    })
    expect(session.kind).toBe('project')
    expect(session.memberIds).toEqual(['u-alice', 'u-bob'])
    expect(await isMember(pool, session.id, 'u-alice')).toBe(true)
    expect(await isMember(pool, session.id, 'u-carol')).toBe(false)
  })

  it('lists sessions with unread counts', async () => {
    const session = await createSession(pool, {
      kind: 'project',
      title: '报销系统',
      memberIds: ['u-alice', 'u-bob'],
    })
    await createMessage(pool, {
      sessionId: session.id,
      senderId: 'u-bob',
      senderKind: 'human',
      contentType: 'text',
      content: '你好',
      clientMsgId: 'c1',
    })
    const list = await listSessionsForUser(pool, 'u-alice')
    expect(list).toHaveLength(1)
    expect(list[0]!.unreadCount).toBe(1)
    await markRead(pool, session.id, 'u-alice', 1)
    const after = await listSessionsForUser(pool, 'u-alice')
    expect(after[0]!.unreadCount).toBe(0)
  })

  it('excludes sessions where user is not a member', async () => {
    const session = await createSession(pool, {
      kind: 'group',
      title: '财务群',
      memberIds: ['u-bob'],
    })
    const list = await listSessionsForUser(pool, 'u-alice')
    expect(list).toHaveLength(0)
    void session
  })
})
```

- [ ] **Step 5: 写 repos/messages.test.ts**

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from './test-helpers.js'
import { createSession } from './sessions.js'
import { createMessage, listMessages } from './messages.js'

describe('message repository', () => {
  let pool: pg.Pool
  let sessionId: string

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
    const session = await createSession(pool, {
      kind: 'project',
      title: '报销系统',
      memberIds: ['u-alice', 'u-bob'],
    })
    sessionId = session.id
  })

  it('assigns monotonic seq in send order', async () => {
    const a = await createMessage(pool, {
      sessionId,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content: '第一条',
      clientMsgId: 'a1',
    })
    const b = await createMessage(pool, {
      sessionId,
      senderId: 'u-bob',
      senderKind: 'human',
      contentType: 'text',
      content: '第二条',
      clientMsgId: 'b1',
    })
    expect(a.message.seq).toBe(1)
    expect(b.message.seq).toBe(2)
    expect(a.created).toBe(true)
  })

  it('returns the existing message on duplicate clientMsgId', async () => {
    const first = await createMessage(pool, {
      sessionId,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content: '唯一',
      clientMsgId: 'dup-1',
    })
    const second = await createMessage(pool, {
      sessionId,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content: '唯一',
      clientMsgId: 'dup-1',
    })
    expect(second.created).toBe(false)
    expect(second.message.id).toBe(first.message.id)
    expect(second.message.seq).toBe(1)
  })

  it('lists messages after a given seq', async () => {
    await createMessage(pool, {
      sessionId,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content: 'm1',
      clientMsgId: 'm1',
    })
    await createMessage(pool, {
      sessionId,
      senderId: 'u-bob',
      senderKind: 'human',
      contentType: 'text',
      content: 'm2',
      clientMsgId: 'm2',
    })
    const after = await listMessages(pool, sessionId, 1, 10)
    expect(after).toHaveLength(1)
    expect(after[0]!.content).toBe('m2')
    expect(after[0]!.seq).toBe(2)
  })

  it('fails when session does not exist', async () => {
    await expect(
      createMessage(pool, {
        sessionId: '00000000-0000-0000-0000-000000000000',
        senderId: 'u-alice',
        senderKind: 'human',
        contentType: 'text',
        content: 'x',
        clientMsgId: 'x1',
      }),
    ).rejects.toThrow(/session not found/)
  })

  it('treats clientMsgId as globally unique per sender across sessions (幂等契约)', async () => {
    const session2 = await createSession(pool, {
      kind: 'project',
      title: '另一个项目',
      memberIds: ['u-alice'],
    })
    const first = await createMessage(pool, {
      sessionId,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content: 'A',
      clientMsgId: 'global-1',
    })
    const replay = await createMessage(pool, {
      sessionId: session2.id,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content: 'B',
      clientMsgId: 'global-1',
    })
    expect(replay.created).toBe(false)
    expect(replay.message.sessionId).toBe(sessionId)
    expect(replay.message.content).toBe('A')
  })

  it('assigns unique seqs under concurrent sends (并发性质)', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createMessage(pool, {
          sessionId,
          senderId: `u-w${i}`,
          senderKind: 'human',
          contentType: 'text',
          content: `w${i}`,
          clientMsgId: `w-${i}`,
        }),
      ),
    )
    const seqs = results.map((r) => r.message.seq).sort((a, b) => a - b)
    expect(new Set(seqs).size).toBe(10)
    expect(seqs[0]).toBe(1)
    expect(seqs[9]).toBe(10)
  })

  it('dedupes concurrent sends with the same clientMsgId (并发幂等，可捕获池死锁)', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        createMessage(pool, {
          sessionId,
          senderId: 'u-alice',
          senderKind: 'human',
          contentType: 'text',
          content: '同一条',
          clientMsgId: 'same-1',
        }),
      ),
    )
    const created = results.filter((r) => r.created)
    expect(created).toHaveLength(1)
    const ids = new Set(results.map((r) => r.message.id))
    expect(ids.size).toBe(1)
    // 落库仅 1 行
    const count = await pool.query('SELECT count(*)::int AS n FROM messages WHERE session_id = $1', [sessionId])
    expect(count.rows[0]!.n).toBe(1)
  })
})
```

- [ ] **Step 6: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps   # db healthy
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: 新增 repos 测试（sessions 3 + messages 4）全 PASS，原有 17 用例不回归。

- [ ] **Step 7: 提交**

```bash
git add services/gateway
git commit -m "feat(gateway): 会话/消息仓储（seq 事务 + clientMsgId 幂等 + 已读）"
```

---

## Task 3: 路由层（会话 + 消息 + 已读 + requireAuth）

**Files:**
- Create: `services/gateway/src/middleware.ts`
- Create: `services/gateway/src/routes/sessions.ts`
- Create: `services/gateway/src/routes/messages.ts`
- Create: `services/gateway/src/routes/sessions.test.ts`
- Create: `services/gateway/src/routes/messages.test.ts`
- Modify: `services/gateway/src/server.ts`

- [ ] **Step 1: 写 middleware.ts**

```ts
import type { FastifyReply, FastifyRequest } from 'fastify'
import { verifyToken, type JwtUser } from './auth.js'
import type { Config } from './config.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtUser
  }
}

export function requireAuth(config: Config) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const match = /^Bearer\s+(\S+)$/.exec(request.headers.authorization ?? '')
    if (!match) {
      await reply.code(401).send({ error: 'malformed authorization header' })
      return
    }
    const user = await verifyToken(match[1]!, config)
    if (!user) {
      await reply.code(401).send({ error: 'invalid token' })
      return
    }
    request.user = user
  }
}
```

- [ ] **Step 2: 写 routes/sessions.ts**

```ts
import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware.js'
import { createSession, getSessionById, isMember, listSessionsForUser } from '../repos/sessions.js'
import type { Config } from '../config.js'
import pg from 'pg'

export function registerSessionRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const auth = requireAuth(config)

  app.post<{ Body: { kind?: string; title?: string; memberIds?: string[] } }>(
    '/api/v1/sessions',
    { preHandler: auth },
    async (request, reply) => {
      const kind = request.body?.kind
      const title = request.body?.title?.trim()
      const memberIds = request.body?.memberIds
      if (kind !== 'direct' && kind !== 'project' && kind !== 'group') {
        return reply.code(400).send({ error: 'kind must be direct|project|group' })
      }
      if (!title || title.length > 200) {
        return reply.code(400).send({ error: 'title is required (<=200 chars)' })
      }
      if (!Array.isArray(memberIds) || memberIds.length === 0 || memberIds.length > 100) {
        return reply.code(400).send({ error: 'memberIds must be a non-empty array (<=100)' })
      }
      if (!memberIds.every((m) => typeof m === 'string' && m.length > 0 && m.length <= 128)) {
        return reply.code(400).send({ error: 'memberIds must contain non-empty strings (<=128 chars)' })
      }
      const userId = request.user!.id
      const session = await createSession(pool, {
        kind,
        title,
        memberIds: [...new Set([userId, ...memberIds])],
      })
      return reply.code(201).send({ session })
    },
  )

  app.get('/api/v1/sessions', { preHandler: auth }, async (request) => {
    const userId = request.user!.id
    const sessions = await listSessionsForUser(pool, userId)
    return { sessions }
  })

  app.get('/api/v1/sessions/:id', { preHandler: auth }, async (request, reply) => {
    const sessionId = (request.params as { id: string }).id
    const userId = request.user!.id
    if (!(await isMember(pool, sessionId, userId))) {
      // 区分 404/403（T3 spec 审查）：isMember 对不存在会话恒 false（FK 保证无成员行），必须回查存在性
      const exists = await getSessionById(pool, sessionId)
      if (!exists) return reply.code(404).send({ error: 'session not found' })
      return reply.code(403).send({ error: 'not a member of this session' })
    }
    const session = await getSessionById(pool, sessionId)
    if (!session) return reply.code(404).send({ error: 'session not found' })
    return { session }
  })
}
```

- [ ] **Step 3: 写 routes/messages.ts**

```ts
import type { FastifyInstance } from 'fastify'
import { isMessageContentType } from '@ta/contracts'
import { requireAuth } from '../middleware.js'
import { isMember } from '../repos/sessions.js'
import { createMessage, listMessages } from '../repos/messages.js'
import { markRead } from '../repos/sessions.js'
import type { Config } from '../config.js'
import pg from 'pg'

const MAX_LIMIT = 100

export function registerMessageRoutes(
  app: FastifyInstance,
  config: Config,
  pool: pg.Pool,
  onMessageCreated: (message: unknown) => void,
): void {
  const auth = requireAuth(config)

  app.get<{ Params: { id: string }; Querystring: { after_seq?: string; limit?: string } }>(
    '/api/v1/sessions/:id/messages',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      const userId = request.user!.id
      if (!(await isMember(pool, sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const afterSeq = Math.max(0, Number(request.query.after_seq ?? 0) || 0)
      const limit = Math.min(MAX_LIMIT, Math.max(1, Number(request.query.limit ?? 50) || 50))
      const messages = await listMessages(pool, sessionId, afterSeq, limit)
      return { messages }
    },
  )

  app.post<{ Params: { id: string }; Body: { clientMsgId?: string; contentType?: string; content?: string } }>(
    '/api/v1/sessions/:id/messages',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      const userId = request.user!.id
      if (!(await isMember(pool, sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const clientMsgId = request.body?.clientMsgId?.trim()
      const contentType = request.body?.contentType
      const content = request.body?.content
      if (!clientMsgId || clientMsgId.length > 128) {
        return reply.code(400).send({ error: 'clientMsgId is required (<=128 chars)' })
      }
      if (!contentType || !isMessageContentType(contentType)) {
        return reply.code(400).send({ error: 'contentType is invalid' })
      }
      if (typeof content !== 'string' || content.length === 0 || content.length > 10000) {
        return reply.code(400).send({ error: 'content is required (<=10000 chars)' })
      }
      const { message, created } = await createMessage(pool, {
        sessionId,
        senderId: userId,
        senderKind: 'human',
        contentType,
        content,
        clientMsgId,
      })
      if (created) onMessageCreated(message)
      return reply.code(created ? 201 : 200).send({ message })
    },
  )

  app.post<{ Params: { id: string }; Body: { seq?: number } }>(
    '/api/v1/sessions/:id/read',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      const userId = request.user!.id
      if (!(await isMember(pool, sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const seq = request.body?.seq
      if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
        return reply.code(400).send({ error: 'seq must be a non-negative integer' })
      }
      await markRead(pool, sessionId, userId, seq)
      return reply.code(204).send()
    },
  )
}
```

- [ ] **Step 4: 修改 server.ts（用 edit 替换整个文件）**

```ts
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { loadConfig, type Config } from './config.js'
import { createPool } from './db.js'
import { createRegistry, type ConnectionRegistry } from './registry.js'
import { createEvents } from './events.js'
import { registerHealth } from './routes/health.js'
import { registerAuth } from './routes/auth.js'
import { registerMe } from './routes/me.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { registerMessageRoutes } from './routes/messages.js'
import { registerWs } from './ws.js'
import pg from 'pg'

export interface BuiltApp {
  app: ReturnType<typeof Fastify>
  config: Config
  pool: pg.Pool
  registry: ConnectionRegistry
}

export async function buildApp(overrides?: Partial<Config>): Promise<BuiltApp> {
  const config = { ...loadConfig(), ...overrides }
  const app = Fastify({ logger: false, ajv: { customOptions: { coerceTypes: false } } })
  const pool = createPool(config.databaseUrl)
  const registry = createRegistry()
  const events = createEvents()
  app.addHook('onClose', async () => {
    await pool.end()
  })
  await app.register(websocket)
  registerHealth(app)
  registerAuth(app, config)
  registerMe(app, config)
  registerSessionRoutes(app, config, pool)
  registerMessageRoutes(app, config, pool, (message) => {
    events.emit('message.created', message)
  })
  registerWs(app, config, pool, registry, events)
  return { app, config, pool, registry }
}
```

- [ ] **Step 5: 写 routes/sessions.test.ts**

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('session routes', () => {
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

  it('creates a session as a member', async () => {
    const token = await loginAs('alice')
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    expect(res.statusCode).toBe(201)
    const { session } = res.json()
    expect(session.kind).toBe('project')
    expect(session.memberIds).toContain('u-alice')
    expect(session.memberIds).toContain('u-bob')
  })

  it('requires auth', async () => {
    const res = await built.app.inject({ method: 'GET', url: '/api/v1/sessions' })
    expect(res.statusCode).toBe(401)
  })

  it('lists only my sessions', async () => {
    const alice = await loginAs('alice')
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '我的项目', memberIds: ['u-alice'] },
    })
    expect(created.statusCode).toBe(201)
    const aliceList = await built.app.inject({
      method: 'GET',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(aliceList.json().sessions).toHaveLength(1)
    const bob = await loginAs('bob')
    const bobList = await built.app.inject({
      method: 'GET',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${bob}` },
    })
    expect(bobList.statusCode).toBe(200)
    expect(bobList.json().sessions).toHaveLength(0)
  })

  it('rejects non-string memberIds', async () => {
    const alice = await loginAs('alice')
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'group', title: '群', memberIds: [123] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('denies non-members reading a session', async () => {
    const alice = await loginAs('alice')
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'group', title: '私密群', memberIds: ['u-bob'] },
    })
    const sessionId = created.json().session.id
    const carol = await loginAs('carol')
    const res = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${carol}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 404 for a non-existent session', async () => {
    const alice = await loginAs('alice')
    const res = await built.app.inject({
      method: 'GET',
      url: '/api/v1/sessions/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(res.statusCode).toBe(404)
  })
  })
})
```

- [ ] **Step 6: 写 routes/messages.test.ts**

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('message routes', () => {
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

  async function createProjectSession(token: string): Promise<string> {
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    return res.json().session.id as string
  }

  it('sends and lists messages with seq order', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const first = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'm1', contentType: 'text', content: '第一条' },
    })
    expect(first.statusCode).toBe(201)
    expect(first.json().message.seq).toBe(1)
    const second = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'm2', contentType: 'text', content: '第二条' },
    })
    expect(second.json().message.seq).toBe(2)
    const list = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().messages).toHaveLength(2)
  })

  it('replays the same message on duplicate clientMsgId (200)', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const payload = { clientMsgId: 'dup', contentType: 'text', content: '唯一' }
    const first = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload,
    })
    const second = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload,
    })
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(200)
    expect(second.json().message.id).toBe(first.json().message.id)
  })

  it('rejects invalid content types', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'x', contentType: 'carrier-pigeon', content: 'hi' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('denies non-member sending', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const carol = await loginAs('carol')
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${carol}` },
      payload: { clientMsgId: 'x', contentType: 'text', content: '侵入' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('marks read', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'm1', contentType: 'text', content: '第一条' },
    })
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/read`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { seq: 1 },
    })
    expect(res.statusCode).toBe(204)
  })
})
```

> 注：`server.ts` 引用了 `./registry.js` 与 `./events.js`（Task 4 创建）。本 Task 需先放两个**最小占位**保证编译：
> `src/registry.ts`：`export interface ConnectionRegistry {}` + `export function createRegistry(): ConnectionRegistry { return {} }`
> `src/events.ts`：`import { EventEmitter } from 'node:events'` + `export function createEvents() { return new EventEmitter() }`
> Task 4 替换为完整实现。

- [ ] **Step 7: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: 新增路由测试（sessions 4 + messages 5）全 PASS；仓储测试 7 + 原有 17 不回归。

- [ ] **Step 8: 提交**

```bash
git add services/gateway
git commit -m "feat(gateway): 会话/消息/已读路由（requireAuth + 成员校验）"
```

---

## Task 4: WS 实时推送（registry + 广播 + 契约 WsEvent）

**Files:**
- Modify: `packages/contracts/src/index.ts`（增 WsEvent）
- Create: `services/gateway/src/registry.ts`（完整实现，替换占位）
- Create: `services/gateway/src/events.ts`（完整实现，替换占位）
- Modify: `services/gateway/src/ws.ts`（完整实现，替换）
- Create: `services/gateway/src/ws-push.test.ts`

- [ ] **Step 1: 修改 packages/contracts/src/index.ts**

在文件末尾追加：

```ts
export interface WsMessageNew {
  type: 'message.new'
  message: Message
}

export type WsEvent = WsMessageNew
```

- [ ] **Step 2: 写 src/registry.ts（完整实现）**

```ts
import type { WebSocket } from 'ws'

export interface RegistryEntry {
  socket: WebSocket
  userId: string
  sessionIds: Set<string>
}

export interface ConnectionRegistry {
  add(entry: RegistryEntry): void
  remove(socket: WebSocket): void
  broadcast(sessionId: string, payload: unknown): void
  socketsFor(sessionId: string): WebSocket[]
}

export function createRegistry(): ConnectionRegistry {
  const bySocket = new Map<WebSocket, RegistryEntry>()
  const bySession = new Map<string, Set<WebSocket>>()

  return {
    add(entry) {
      bySocket.set(entry.socket, entry)
      for (const sessionId of entry.sessionIds) {
        const set = bySession.get(sessionId) ?? new Set<WebSocket>()
        set.add(entry.socket)
        bySession.set(sessionId, set)
      }
    },
    remove(socket) {
      const entry = bySocket.get(socket)
      if (!entry) return
      bySocket.delete(socket)
      for (const sessionId of entry.sessionIds) {
        const set = bySession.get(sessionId)
        set?.delete(socket)
        if (set?.size === 0) bySession.delete(sessionId)
      }
    },
    broadcast(sessionId, payload) {
      const text = JSON.stringify(payload)
      for (const socket of this.socketsFor(sessionId)) {
        if (socket.readyState === 1) socket.send(text)
      }
    },
    socketsFor(sessionId) {
      return [...(bySession.get(sessionId) ?? [])]
    },
  }
}
```

- [ ] **Step 3: 写 src/events.ts（完整实现，载荷定型 Message）**

```ts
import { EventEmitter } from 'node:events'
import type { Message } from '@ta/contracts'

export type AppEvents = {
  'message.created': (message: Message) => void
}

export interface AppEventBus {
  on<K extends keyof AppEvents>(event: K, listener: AppEvents[K]): void
  emit<K extends keyof AppEvents>(event: K, payload: Parameters<AppEvents[K]>[0]): void
}

export function createEvents(): AppEventBus {
  const emitter = new EventEmitter()
  return {
    on(event, listener) {
      emitter.on(event, listener)
    },
    emit(event, payload) {
      emitter.emit(event, payload)
    },
  }
}
```

- [ ] **Step 4: 写 src/ws.ts（完整实现，替换；含 T4 质量审查三项修复）**

```ts
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import type { Message, WsMessageNew } from '@ta/contracts'
import { verifyToken } from './auth.js'
import type { Config } from './config.js'
import type { ConnectionRegistry } from './registry.js'
import type { AppEventBus } from './events.js'
import { listSessionIdsForUser } from './repos/sessions.js'
import type pg from 'pg'

const OPEN = 1

export function registerWs(
  app: FastifyInstance,
  config: Config,
  pool: pg.Pool,
  registry: ConnectionRegistry,
  events: AppEventBus,
): void {
  app.get('/ws', { websocket: true }, (socket: WebSocket, request) => {
    const token = (request.query as { token?: string }).token
    let authed = false
    // 终态监听必须在异步鉴权之前挂载：窗口期断连不产生死 socket（泄漏修复）
    socket.on('close', () => registry.remove(socket))
    socket.on('error', () => registry.remove(socket))
    socket.on('message', (raw) => {
      if (!authed || socket.readyState !== OPEN) return
      // 调试 echo（Plan 3 移除）
      socket.send(JSON.stringify({ type: 'echo', data: raw.toString() }))
    })
    void (async () => {
      try {
        const user = token ? await verifyToken(token, config) : null
        if (!user) {
          socket.close(4401, 'unauthorized')
          return
        }
        if (socket.readyState !== OPEN) return // 鉴权期间已断开，不注册
        const sessionIds = new Set(await listSessionIdsForUser(pool, user.id))
        registry.add({ socket, userId: user.id, sessionIds })
        authed = true
        if (socket.readyState === OPEN) {
          socket.send(JSON.stringify({ type: 'welcome', user: { id: user.id, name: user.name } }))
        }
      } catch {
        // 握手期异常（DB 故障等）不得崩溃进程（悬浮 IIFE 修复）
        socket.close(1011, 'internal error')
      }
    })()
  })

  events.on('message.created', (message) => {
    const msg = message as Message
    if (typeof msg.sessionId !== 'string') return // 运行时守卫
    const payload: WsMessageNew = { type: 'message.new', message: msg }
    registry.broadcast(msg.sessionId, payload)
  })
}
```

- [ ] **Step 5: 写 src/ws-push.test.ts**

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'
import pg from 'pg'
import { buildApp, type BuiltApp } from './server.js'
import { createTestPool, truncateAll } from './repos/test-helpers.js'

const open = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })

function collect(ws: WebSocket): { messages: string[]; waitFor: (count: number) => Promise<void> } {
  const messages: string[] = []
  ws.on('message', (data) => messages.push(data.toString()))
  return {
    messages,
    waitFor: (count: number) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (messages.length >= count) resolve()
          else setTimeout(check, 10)
        }
        check()
      }),
  }
}

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (address === null || typeof address === 'string') throw new Error('unexpected address')
  return address.port
}

describe('gateway ws push', () => {
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

  it('pushes message.new to session members over ws', async () => {
    const alice = await loginAs('alice')
    const sessionRes = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    const sessionId = sessionRes.json().session.id as string

    const port = await listen(built.app)
    const bobToken = await loginAs('bob')
    const bob = await open(`ws://127.0.0.1:${port}/ws?token=${bobToken}`)
    const bobColl = collect(bob)
    await bobColl.waitFor(1) // welcome

    const aliceToken = await loginAs('alice')
    const aliceWs = await open(`ws://127.0.0.1:${port}/ws?token=${aliceToken}`)
    const aliceColl = collect(aliceWs)
    await aliceColl.waitFor(1) // welcome

    const send = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { clientMsgId: 'push-1', contentType: 'text', content: '新消息来了' },
    })
    expect(send.statusCode).toBe(201)

    await bobColl.waitFor(2)
    const event = JSON.parse(bobColl.messages[1] as string) as { type: string; message: { content: string; seq: number } }
    expect(event.type).toBe('message.new')
    expect(event.message.content).toBe('新消息来了')
    expect(event.message.seq).toBe(1)

    bob.close()
    aliceWs.close()
  })

  it('does not push to non-members', async () => {
    const alice = await loginAs('alice')
    const sessionRes = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    const sessionId = sessionRes.json().session.id as string

    const port = await listen(built.app)
    const carol = await open(`ws://127.0.0.1:${port}/ws?token=${await loginAs('carol')}`)
    const carolColl = collect(carol)
    await carolColl.waitFor(1) // welcome

    const aliceToken = await loginAs('alice')
    await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { clientMsgId: 'push-2', contentType: 'text', content: '机密' },
    })

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(carolColl.messages).toHaveLength(1) // 只有 welcome，无 message.new

    carol.close()
  })
})
```

- [ ] **Step 6: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm install
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: 新增 ws-push 2 用例全 PASS；全部既有用例（repos 7 + routes 9 + ws 2 + config 5 + server 10）不回归。

- [ ] **Step 7: 提交**

```bash
git add packages/contracts services/gateway
git commit -m "feat(gateway): WS 实时推送（注册表 + message.new 广播 + 契约 WsEvent）"
```

---

## Task 5: 收尾（README + 全仓验收 + 推送）

**Files:**
- Modify: `README.md`（根）

- [ ] **Step 1: README 追加「本地开发依赖」与消息引擎说明**

在 README 的 `## 开发` 一节顶部追加：

```markdown
### 本地依赖（PG）

```bash
# 一次性：brew install postgresql@16 && brew services start postgresql@16
# 一次性：创建角色与库（见计划 2 头部「本地 PG 初始化」）
pnpm --filter @ta/gateway migrate                    # 应用迁移（幂等）
```

> 网关集成测试需要本地 PG 运行（`postgres://ta:ta@localhost:5432/ta_dev`）；未启动会 fail fast。部署路径可用 `docker compose -f deploy/docker-compose.yml up -d` 起同配置 PG。

### 消息引擎冒烟

```bash
# 登录 → 建会话 → 发消息 → 拉消息 → 标记已读
TOKEN=$(curl -s -X POST localhost:3001/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"username":"alice"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

curl -s -X POST localhost:3001/api/v1/sessions -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"kind":"project","title":"报销系统","memberIds":["u-bob"]}'

curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/messages \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"clientMsgId":"m1","contentType":"text","content":"你好"}'

curl -s "localhost:3001/api/v1/sessions/<sessionId>/messages?after_seq=0" -H "authorization: Bearer $TOKEN"
```
```

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm build
pnpm test
pnpm install --frozen-lockfile
```

Expected: 全部构建成功；测试全绿（contracts 2 + gateway 全部）；frozen-lockfile 通过；`git status` 干净（除待提交文件）。

- [ ] **Step 3: 提交 + 推送**

```bash
git add README.md
git commit -m "docs: README 补 PG 本地依赖与消息引擎冒烟"
git push
```

Expected: 推送成功，`origin/main` 更新。

---

## Self-Review 记录（写完后自查）

- **Spec 覆盖**：路线图 M0.3（IM 消息引擎核心）→ Task 1（DB 基建）/ Task 2（仓储）/ Task 3（路由）/ Task 4（WS 推送）；M0.2 认证 → requireAuth 复用；契约延后项（WS 事件）→ Task 4 WsEvent。
- **占位符扫描**：无 TBD；Task 3 的 registry/events 占位是**有意的执行顺序占位**，Task 4 完整替换，计划已注明；Task 1 的 migrate.ts 入口判断注明了备用方案。
- **类型一致性**：`buildApp` 返回 `{app, config, pool, registry}` 在 Task 3/4 测试中一致；`createMessage` 返回 `{message, created}` 在仓储/路由/测试一致；`WsEvent` 的 `message.new` 与 ws.ts 广播 payload、ws-push 测试断言一致；`Config.databaseUrl` 在 config/db/server/测试一致。
- **环境事实**：Docker 28 可用；PG 16 镜像拉取需网络（首次）；`gen_random_uuid()` PG13+ 内置无需扩展。
- **已知取舍**：用户表延后（senderId 为 `u-<username>` 字符串，来自演示登录 JWT）；Redis 延后（进程内注册表，单实例）；echo 调试消息保留至 Plan 3；未读数在列表接口实时 count（MVP 够用）。

## 决策记录（T1 质量审查后）

1. **clientMsgId 幂等契约（定死）**：`clientMsgId` 必须**全局唯一**（每个发送者全局，建议客户端生成 UUID）。约束 `UNIQUE (sender_id, client_msg_id)` 保持不变；同一 sender 跨会话复用同一 id 返回既有消息（幂等重放语义，跨会话复用属客户端 bug，行为由测试固化）。不做每会话计数 id（那需要 `(session_id, sender_id, client_msg_id)` 三列约束，本计划不采用）。
2. **索引修正**：`session_members.user_id` 加单列索引（Important）；`idx_messages_session_seq` 删除（`(session_id, seq)` UNIQUE 已自带索引，冗余）。001 已应用的环境手工收敛 DDL。
3. **迁移 runner 并发防护**：`pg_advisory_lock(726827367)` 串行化（双进程迁移时败者不再 23505 崩溃）。
4. **DATABASE_URL 守卫**：非 dev 环境缺失或使用 dev 默认串即抛错；守卫测试补齐。
