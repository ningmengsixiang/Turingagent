# Phase 1 · 计划 1：审批流 + 确认卡片（BL-4 起点）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 PR-1「人类审批闸门」的工程基础：会话内可发起审批（确认卡片消息），指定审批人可通过/驳回，卡片状态经 WS 实时同步到所有成员。完成 BL-4（审批决策线）的 MVP 闭环（单人审批 + 确认卡片 + 卡片状态流转）。

**Architecture:** 后端三件套：`002_approvals.sql` 迁移（approvals 表 + messages 表补 `ref_kind/ref_id` 列）→ `repos/approvals.ts`（状态机：pending → approved/rejected，非 pending 不可再决）→ `routes/approvals.ts`（发起审批=建 approval + 建 ConfirmationCard 消息 + emit；决策=更新 approval + 更新卡片消息 + emit `message.updated`）。契约补 `WsMessageUpdated` 事件与 `Approval.description/createdBy` 字段。前端 Chat 渲染确认卡片（pending 显示通过/驳回按钮，非 pending 显示状态），WS `message.updated` 原位替换消息。

**Tech Stack:** 既有（Fastify + pg + vitest + React）；审批状态机单级（FR-APP-01，多级/会签 Phase 2）。

**决策记录：** 审批人须为会话成员（创建时校验）；仅 approver 可决策（MVP）；卡片状态变更通过「更新消息内容 + `message.updated` 事件」同步（复用既有 message 链路，不引入独立卡片协议）；`approval.created/decided` 事件暂不单独定义（卡片消息即载体，Phase 2 多级审批时再拆）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/migrations/002_approvals.sql` | 创建 | approvals 表 + messages 补 ref 列 |
| `packages/contracts/src/index.ts` | 修改 | Approval 补 description/createdBy；WsEvent 补 WsMessageUpdated |
| `services/gateway/src/repos/approvals.ts` | 创建 | 审批仓储（状态机） |
| `services/gateway/src/repos/approvals.test.ts` | 创建 | 状态机测试 |
| `services/gateway/src/repos/messages.ts` | 修改 | 支持 ref 列读写 + updateMessage |
| `services/gateway/src/routes/approvals.ts` | 创建 | 发起/决策路由 |
| `services/gateway/src/routes/approvals.test.ts` | 创建 | 路由测试（含 WS 事件） |
| `services/gateway/src/events.ts` | 修改 | AppEvents 补 message.updated |
| `services/gateway/src/ws.ts` | 修改 | 订阅 message.updated 广播 |
| `apps/web/src/api/client.ts` | 修改 | createApproval/decideApproval + Approval 类型 |
| `apps/web/src/pages/Chat.tsx` | 修改 | 确认卡片渲染 + 通过/驳回 + message.updated 原位替换 |
| `apps/web/src/pages/Chat.test.tsx` | 修改 | 卡片渲染/决策/更新用例 |
| `README.md` | 修改 | 审批冒烟说明 |

---

## Task 1: 迁移 + 契约 + 审批仓储

**Files:**
- Create: `services/gateway/migrations/002_approvals.sql`
- Modify: `packages/contracts/src/index.ts`
- Create: `services/gateway/src/repos/approvals.ts`
- Create: `services/gateway/src/repos/approvals.test.ts`
- Modify: `services/gateway/src/repos/messages.ts`（ref 列支持 + updateMessage）

- [ ] **Step 1: 写 migrations/002_approvals.sql**

```sql
CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approver_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  reason TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approvals_session ON approvals (session_id);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS ref_kind TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ref_id TEXT;
```

- [ ] **Step 2: 修改 contracts（在 Approval 接口补字段、文件末尾 WsEvent 区补事件）**

Approval 接口改为：

```ts
export interface Approval {
  id: string
  sessionId: string
  title: string
  description?: string
  status: ApprovalStatus
  approverId: string
  createdBy: string
  reason?: string
  createdAt: string
  decidedAt?: string
}
```

文件末尾 WsEvent 区改为：

```ts
export interface WsMessageNew {
  type: 'message.new'
  message: Message
}

export interface WsMessageUpdated {
  type: 'message.updated'
  message: Message
}

export type WsEvent = WsMessageNew | WsMessageUpdated
```

- [ ] **Step 3: 写 repos/approvals.ts**

```ts
import pg from 'pg'
import type { Approval, ApprovalStatus } from '@ta/contracts'

export interface ApprovalRow {
  id: string
  session_id: string
  title: string
  description: string
  status: string
  approver_id: string
  created_by: string
  reason: string | null
  decided_at: Date | null
  created_at: Date
}

export function mapApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    description: row.description || undefined,
    status: row.status as ApprovalStatus,
    approverId: row.approver_id,
    createdBy: row.created_by,
    reason: row.reason ?? undefined,
    createdAt: row.created_at.toISOString(),
    decidedAt: row.decided_at?.toISOString(),
  }
}

export class ApprovalStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApprovalStateError'
  }
}

export async function createApproval(
  pool: pg.Pool,
  input: { sessionId: string; title: string; description?: string; approverId: string; createdBy: string },
): Promise<Approval> {
  const res = await pool.query<ApprovalRow>(
    `INSERT INTO approvals (session_id, title, description, approver_id, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.sessionId, input.title, input.description ?? '', input.approverId, input.createdBy],
  )
  return mapApproval(res.rows[0]!)
}

export async function getApproval(pool: pg.Pool, id: string): Promise<Approval | null> {
  const res = await pool.query<ApprovalRow>('SELECT * FROM approvals WHERE id = $1', [id])
  return res.rows[0] ? mapApproval(res.rows[0]) : null
}

export async function decideApproval(
  pool: pg.Pool,
  input: { id: string; approverId: string; decision: 'approved' | 'rejected'; reason?: string },
): Promise<Approval> {
  const current = await getApproval(pool, input.id)
  if (!current) throw new ApprovalStateError('approval not found')
  if (current.status !== 'pending') throw new ApprovalStateError(`approval already ${current.status}`)
  if (current.approverId !== input.approverId) {
    throw new ApprovalStateError('only the approver can decide')
  }
  // 条件更新（T1 质量审查：并发双裁决竞态修复）——WHERE 带 status='pending'，
  // 先读后写的窗口期被行锁 + 条件覆盖，胜者恰一次，败者抛 AlreadyDecided
  const res = await pool.query<ApprovalRow>(
    `UPDATE approvals
        SET status = $2, reason = $3, decided_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING *`,
    [input.id, input.decision, input.reason ?? null],
  )
  if (res.rowCount !== 1) {
    const now = await getApproval(pool, input.id)
    if (!now) throw new ApprovalStateError('approval not found')
    throw new ApprovalStateError(`approval already ${now.status}`)
  }
  return mapApproval(res.rows[0]!)
}

export async function getApprovalByRef(pool: pg.Pool, refId: string): Promise<Approval | null> {
  return getApproval(pool, refId)
}
```

- [ ] **Step 4: 修改 repos/messages.ts（ref 列 + updateMessage）**

MessageRow 接口增 `ref_kind: string | null`、`ref_id: string | null`；`mapMessage` 增 `ref` 映射：

```ts
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
    ref:
      row.ref_kind && row.ref_id
        ? { kind: row.ref_kind as 'approval' | 'task', id: row.ref_id }
        : undefined,
    seq: Number(row.seq),
    createdAt: row.created_at.toISOString(),
  }
}
```

`createMessage` 的 INSERT 增 ref 列（input 增 `ref?: { kind: 'approval' | 'task'; id: string }`）：

```ts
    const ins = await client.query<MessageRow>(
      `INSERT INTO messages (session_id, sender_id, sender_kind, content_type, content, client_msg_id, seq, ref_kind, ref_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [input.sessionId, input.senderId, input.senderKind, input.contentType, input.content, input.clientMsgId, seq, input.ref?.kind ?? null, input.ref?.id ?? null],
    )
```

文件末尾追加 `updateMessageContent`：

```ts
export async function updateMessageContent(
  pool: pg.Pool,
  messageId: string,
  content: string,
): Promise<Message | null> {
  const res = await pool.query<MessageRow>(
    'UPDATE messages SET content = $2 WHERE id = $1 RETURNING *',
    [messageId, content],
  )
  return res.rows[0] ? mapMessage(res.rows[0]) : null
}
```

- [ ] **Step 5: 写 repos/approvals.test.ts**

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createTestPool, truncateAll } from './test-helpers.js'
import { createSession } from './sessions.js'
import { createApproval, decideApproval, ApprovalStateError, getApproval } from './approvals.js'

describe('approval repository', () => {
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
    const session = await createSession(pool, { kind: 'project', title: '报销系统', memberIds: ['u-alice', 'u-bob'] })
    sessionId = session.id
  })

  it('creates a pending approval', async () => {
    const approval = await createApproval(pool, {
      sessionId,
      title: '上线审批',
      description: '报销系统上线',
      approverId: 'u-bob',
      createdBy: 'u-alice',
    })
    expect(approval.status).toBe('pending')
    expect(approval.approverId).toBe('u-bob')
    expect(approval.createdBy).toBe('u-alice')
  })

  it('approves a pending approval', async () => {
    const approval = await createApproval(pool, {
      sessionId,
      title: '上线审批',
      approverId: 'u-bob',
      createdBy: 'u-alice',
    })
    const decided = await decideApproval(pool, { id: approval.id, approverId: 'u-bob', decision: 'approved' })
    expect(decided.status).toBe('approved')
    expect(decided.decidedAt).toBeTruthy()
  })

  it('rejects with a reason', async () => {
    const approval = await createApproval(pool, {
      sessionId,
      title: '上线审批',
      approverId: 'u-bob',
      createdBy: 'u-alice',
    })
    const decided = await decideApproval(pool, { id: approval.id, approverId: 'u-bob', decision: 'rejected', reason: '缺少测试报告' })
    expect(decided.status).toBe('rejected')
    expect(decided.reason).toBe('缺少测试报告')
  })

  it('refuses to decide twice', async () => {
    const approval = await createApproval(pool, {
      sessionId,
      title: '上线审批',
      approverId: 'u-bob',
      createdBy: 'u-alice',
    })
    await decideApproval(pool, { id: approval.id, approverId: 'u-bob', decision: 'approved' })
    await expect(decideApproval(pool, { id: approval.id, approverId: 'u-bob', decision: 'rejected' })).rejects.toThrow(
      ApprovalStateError,
    )
  })

  it('refuses a non-approver decision', async () => {
    const approval = await createApproval(pool, {
      sessionId,
      title: '上线审批',
      approverId: 'u-bob',
      createdBy: 'u-alice',
    })
    await expect(decideApproval(pool, { id: approval.id, approverId: 'u-alice', decision: 'approved' })).rejects.toThrow(
      ApprovalStateError,
    )
  })

  it('refuses unknown approval', async () => {
    await expect(
      decideApproval(pool, { id: '00000000-0000-0000-0000-000000000000', approverId: 'u-bob', decision: 'approved' }),
    ).rejects.toThrow(ApprovalStateError)
  })

  it('decides exactly once under concurrent decisions (T1 质量审查：并发回归)', async () => {
    const approval = await createApproval(pool, {
      sessionId,
      title: '上线审批',
      approverId: 'u-bob',
      createdBy: 'u-alice',
    })
    const results = await Promise.allSettled([
      decideApproval(pool, { id: approval.id, approverId: 'u-bob', decision: 'approved' }),
      decideApproval(pool, { id: approval.id, approverId: 'u-bob', decision: 'rejected' }),
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1) // 恰一次决策成功
    expect(rejected).toHaveLength(1) // 另一路被拒（AlreadyDecided）
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ApprovalStateError)
    }
    const final = await getApproval(pool, approval.id)
    expect(final?.status).not.toBe('pending') // 终态：approved 或 rejected
  })
})
```

- [ ] **Step 6: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker exec ta-db pg_isready -U ta -d ta_dev
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway migrate
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: migrate 应用 002；typecheck exit 0；既有 60 用例不回归 + 新增 approvals 6 用例全 PASS（总 66）。

- [ ] **Step 7: 提交**

```bash
git add packages/contracts services/gateway
git commit -m "feat(approval): 审批仓储状态机 + 迁移 + 契约（WsMessageUpdated）"
```

---

## Task 2: 审批路由（发起=卡片消息 + 决策=卡片更新 + WS 事件）

**Files:**
- Modify: `services/gateway/src/events.ts`
- Modify: `services/gateway/src/ws.ts`
- Create: `services/gateway/src/routes/approvals.ts`
- Create: `services/gateway/src/routes/approvals.test.ts`
- Modify: `services/gateway/src/server.ts`

- [ ] **Step 1: 修改 events.ts（AppEvents 补 message.updated）**

```ts
export type AppEvents = {
  'message.created': (message: Message) => void
  'message.updated': (message: Message) => void
}
```

- [ ] **Step 2: 修改 ws.ts（订阅 message.updated 广播）**

在 `events.on('message.created', ...)` 之后追加：

```ts
  events.on('message.updated', (message) => {
    const msg = message as Message
    if (typeof msg.sessionId !== 'string') return
    const payload: WsMessageUpdated = { type: 'message.updated', message: msg }
    registry.broadcast(msg.sessionId, payload)
  })
```

（ws.ts 的 contracts import 增 `WsMessageUpdated`。）

- [ ] **Step 3: 写 routes/approvals.ts**

```ts
import type { FastifyInstance } from 'fastify'
import type { Message } from '@ta/contracts'
import { requireAuth } from '../middleware.js'
import { isMember } from '../repos/sessions.js'
import { createMessage, updateMessageContent } from '../repos/messages.js'
import { createApproval, decideApproval, ApprovalStateError } from '../repos/approvals.js'
import type { Config } from '../config.js'
import pg from 'pg'

export function registerApprovalRoutes(
  app: FastifyInstance,
  config: Config,
  pool: pg.Pool,
  emitMessageCreated: (message: Message) => void,
  emitMessageUpdated: (message: Message) => void,
): void {
  const auth = requireAuth(config)

  app.post<{ Params: { id: string }; Body: { title?: string; description?: string; approverId?: string } }>(
    '/api/v1/sessions/:id/approvals',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      const userId = request.user!.id
      if (!(await isMember(pool, sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const title = request.body?.title?.trim()
      const approverId = request.body?.approverId?.trim()
      if (!title || title.length > 200) {
        return reply.code(400).send({ error: 'title is required (<=200 chars)' })
      }
      if (!approverId) {
        return reply.code(400).send({ error: 'approverId is required' })
      }
      if (!(await isMember(pool, sessionId, approverId))) {
        return reply.code(400).send({ error: 'approver must be a member of this session' })
      }
      const approval = await createApproval(pool, {
        sessionId,
        title,
        description: request.body?.description?.trim() || undefined,
        approverId,
        createdBy: userId,
      })
      // 审批卡片消息（PR-1：人类审批闸门的会话内载体）
      const { message } = await createMessage(pool, {
        sessionId,
        senderId: userId,
        senderKind: 'human',
        contentType: 'confirmation_card',
        content: `待审批：${approval.title}`,
        clientMsgId: `approval-card-${approval.id}`,
        ref: { kind: 'approval', id: approval.id },
      })
      emitMessageCreated(message)
      return reply.code(201).send({ approval, cardMessage: message })
    },
  )

  app.post<{ Params: { id: string }; Body: { decision?: string; reason?: string } }>(
    '/api/v1/approvals/:id/decide',
    { preHandler: auth },
    async (request, reply) => {
      const userId = request.user!.id
      const decision = request.body?.decision
      if (decision !== 'approved' && decision !== 'rejected') {
        return reply.code(400).send({ error: 'decision must be approved|rejected' })
      }
      try {
        const approval = await decideApproval(pool, {
          id: request.params.id,
          approverId: userId,
          decision,
          reason: request.body?.reason?.trim() || undefined,
        })
        // 更新卡片消息内容（状态经 message.updated 广播）
        const card = await findCardMessage(pool, approval.id)
        if (card) {
          const suffix = approval.reason ? `（${approval.reason}）` : ''
          const updated = await updateMessageContent(
            pool,
            card.id,
            approval.status === 'approved'
              ? `✅ 已通过：${approval.title}${suffix}`
              : `❌ 已驳回：${approval.title}${suffix}`,
          )
          if (updated) emitMessageUpdated(updated)
        }
        return { approval }
      } catch (err) {
        if (err instanceof ApprovalStateError) {
          return reply.code(409).send({ error: err.message })
        }
        throw err
      }
    },
  )
}

async function findCardMessage(pool: pg.Pool, approvalId: string) {
  const res = await pool.query(
    'SELECT * FROM messages WHERE ref_kind = $1 AND ref_id = $2 ORDER BY seq ASC LIMIT 1',
    ['approval', approvalId],
  )
  return res.rows[0] ? (res.rows[0] as never) : null
}
```

> 注：`findCardMessage` 返回原始行，`updateMessageContent` 需要 message id——可直接查 id：改为 `SELECT id FROM messages WHERE ref_kind='approval' AND ref_id=$1` 再调 updateMessageContent（实现时可简化，以类型正确为准；导出 `findCardMessageId(pool, approvalId): Promise<string | null>` 更清晰）。

- [ ] **Step 4: 修改 server.ts（注册审批路由）**

import 增 `registerApprovalRoutes`；在 `registerMessageRoutes` 之后追加：

```ts
  registerApprovalRoutes(
    app,
    config,
    pool,
    (message) => events.emit('message.created', message),
    (message) => events.emit('message.updated', message),
  )
```

- [ ] **Step 5: 写 routes/approvals.test.ts**

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'
import { listMessages } from '../repos/messages.js'

describe('approval routes', () => {
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

  it('creates an approval with a card message', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '上线审批', description: '报销系统上线', approverId: 'u-bob' },
    })
    expect(res.statusCode).toBe(201)
    const { approval, cardMessage } = res.json()
    expect(approval.status).toBe('pending')
    expect(cardMessage.contentType).toBe('confirmation_card')
    expect(cardMessage.ref).toEqual({ kind: 'approval', id: approval.id })
    const messages = await listMessages(pool, sessionId, 0, 10)
    expect(messages.some((m) => m.contentType === 'confirmation_card')).toBe(true)
  })

  it('rejects a non-member approver', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '上线审批', approverId: 'u-carol' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('approver decides and the card updates', async () => {
    const alice = await loginAs('alice')
    const bob = await loginAs('bob')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '上线审批', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    const decided = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decide`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { decision: 'approved' },
    })
    expect(decided.statusCode).toBe(200)
    expect(decided.json().approval.status).toBe('approved')
    const messages = await listMessages(pool, sessionId, 0, 10)
    const card = messages.find((m) => m.contentType === 'confirmation_card')!
    expect(card.content).toContain('✅ 已通过')
  })

  it('non-approver decision returns 409', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const created = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/approvals`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { title: '上线审批', approverId: 'u-bob' },
    })
    const approvalId = created.json().approval.id as string
    const decided = await built.app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decide`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { decision: 'approved' },
    })
    expect(decided.statusCode).toBe(409)
  })
})
```

- [ ] **Step 6: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；新增 approvals 路由 4 用例全 PASS；总用例 = 66 + 4 = 70。

- [ ] **Step 7: 提交**

```bash
git add services/gateway
git commit -m "feat(approval): 审批路由（确认卡片消息 + 决策更新 + WS 广播）"
```

---

## Task 3: 前端确认卡片

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/Chat.tsx`
- Modify: `apps/web/src/pages/Chat.test.tsx`

- [ ] **Step 1: client.ts 追加审批 API 与类型**

```ts
import type { Approval } from '@ta/contracts'
```

在 `sendMessage` 之后追加：

```ts
export const createApproval = (
  sessionId: string,
  input: { title: string; description?: string; approverId: string },
): Promise<{ approval: Approval; cardMessage: Message }> =>
  request(`/api/v1/sessions/${sessionId}/approvals`, { method: 'POST', body: JSON.stringify(input) })

export const decideApproval = (
  approvalId: string,
  input: { decision: 'approved' | 'rejected'; reason?: string },
): Promise<{ approval: Approval }> =>
  request(`/api/v1/approvals/${approvalId}/decide`, { method: 'POST', body: JSON.stringify(input) })
```

- [ ] **Step 2: Chat.tsx 增卡片渲染 + 决策 + message.updated 处理**

1. import 增 `decideApproval`（或 createApproval，视 UI）与 `Approval` 类型。

2. WS 事件处理增 message.updated 分支（在 message.new 分支旁）：

```tsx
        if (ev.type === 'message.updated' && ev.message) {
          if (ev.message.sessionId === activeIdRef.current) {
            setMessages((prev) => prev.map((m) => (m.id === ev.message!.id ? ev.message! : m)))
          }
        }
```

3. 消息渲染增确认卡片分支（在 `{messages.map(...)}` 中，bubble 之前）：

```tsx
          {messages.map((m) => {
            const isCard = m.contentType === 'confirmation_card'
            const isPending = isCard && m.content.startsWith('待审批')
            return (
              <div key={m.id} className={m.senderKind === 'agent' ? 'bubble-row agent' : 'bubble-row human'}>
                <div className="bubble-meta">
                  {m.senderKind === 'agent' ? <span className="ai-badge">AI</span> : null}
                  <span className="bubble-name">{m.senderKind === 'agent' ? 'Ta-Fullstack' : m.senderId}</span>
                </div>
                {isCard ? (
                  <div className="approval-card">
                    <strong>{m.content}</strong>
                    {m.ref?.kind === 'approval' && isPending ? (
                      <div className="approval-actions">
                        <button className="approve" onClick={() => void decide(m, 'approved')}>通过</button>
                        <button className="reject" onClick={() => void decide(m, 'rejected')}>驳回</button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="bubble">{m.content}</div>
                )}
              </div>
            )
          })}
```

4. 决策函数：

```tsx
  async function decide(message: Message, decision: 'approved' | 'rejected') {
    if (!message.ref || message.ref.kind !== 'approval') return
    setError(null)
    try {
      await decideApproval(message.ref.id, { decision })
      // message.updated 事件会原位更新卡片；这里乐观置为已决，防 WS 延迟
      setMessages((prev) =>
        prev.map((m) =>
          m.id === message.id
            ? { ...m, content: decision === 'approved' ? `✅ 已通过：${message.content.replace('待审批：', '')}` : `❌ 已驳回：${message.content.replace('待审批：', '')}` }
            : m,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '决策失败')
    }
  }
```

- [ ] **Step 3: Chat.test.tsx 增 2 用例**

```tsx
  it('renders a pending confirmation card with decide buttons', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': {
        messages: [{
          id: 'm1', clientMsgId: 'c1', sessionId: 's1', senderId: 'u-alice', senderKind: 'human',
          contentType: 'confirmation_card', content: '待审批：上线审批', seq: 1, createdAt: '',
          ref: { kind: 'approval', id: 'a1' },
        }],
      },
      '/api/v1/approvals/a1/decide': { approval: { id: 'a1', status: 'approved' } },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText('待审批：上线审批')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /通过/ }))
    await waitFor(() => expect(screen.getByText(/✅ 已通过/)).toBeTruthy())
  })

  it('renders a decided card without buttons', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': {
        messages: [{
          id: 'm2', clientMsgId: 'c2', sessionId: 's1', senderId: 'u-alice', senderKind: 'human',
          contentType: 'confirmation_card', content: '✅ 已通过：上线审批', seq: 1, createdAt: '',
          ref: { kind: 'approval', id: 'a2' },
        }],
      },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText('✅ 已通过：上线审批')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /通过/ })).toBeNull()
  })
```

- [ ] **Step 4: app.css 增卡片样式**

```css
.approval-card { padding: 12px 14px; border: 1px solid #e5e5ea; border-radius: 14px; background: #fff; display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
.approval-actions { display: flex; gap: 8px; }
.approval-actions button { padding: 6px 16px; border: none; border-radius: 12px; cursor: pointer; font-size: 13px; }
.approve { background: #34c759; color: #fff; }
.reject { background: #ff3b30; color: #fff; }
```

- [ ] **Step 5: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose
pnpm --filter @ta/web build
```

Expected: typecheck exit 0；web 测试 12 用例全 PASS（10 + 2 新增）；build 产出 dist/。

- [ ] **Step 6: 提交**

```bash
git add apps/web
git commit -m "feat(web): 确认卡片（渲染/通过/驳回/message.updated 原位更新）"
```

---

## Task 4: 收尾（README + 全仓验收 + 推送）

**Files:**
- Modify: `README.md`（根）

- [ ] **Step 1: README 追加「审批与确认卡片」节**

在「### 消息引擎冒烟」之后追加：

```markdown
### 审批与确认卡片

```bash
# 发起审批（approverId 必须是会话成员）
curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/approvals \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"上线审批","description":"报销系统上线","approverId":"u-bob"}'

# 审批人决策（通过/驳回）
curl -s -X POST localhost:3001/api/v1/approvals/<approvalId>/decide \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"decision":"approved"}'
# → 确认卡片消息状态实时更新（message.updated 经 WS 广播）
```
```

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm build
pnpm test
pnpm install --frozen-lockfile
```

Expected: build 全过；test 全绿（contracts 2 + gateway 70 + web 12 = 84）；frozen-lockfile 通过；`git status` 干净（除 README）。

- [ ] **Step 3: 提交 + 推送**

```bash
git add README.md
git commit -m "docs: README 补审批与确认卡片说明"
git push
```

Expected: 推送成功。

---

## Self-Review 记录（写完后自查）

- **Spec 覆盖**：PR-1（人类审批闸门）→ 审批路由 + 卡片消息；FR-APP-01（单人审批）→ decide 状态机；BL-4（审批决策线 MVP）→ 全计划；WsEvent 扩展 → Task 1/2。
- **占位符扫描**：无 TBD；Task 2 的 findCardMessage 注明可简化实现。
- **类型一致性**：`Approval` 契约（description?/createdBy）在 contracts/repo/map/测试一致；`WsMessageUpdated` 在 contracts/events/ws.ts/前端一致；`createMessage` 增 `ref` 参数在 repo/路由/既有调用（不传 ref 为 undefined，兼容）一致。
- **已知取舍**：单级审批（多级/会签 Phase 2）；卡片状态经消息内容表达（无独立卡片协议）；仅 approver 可决策（Phase 2 加会签/转办）；未做审批撤销/超时升级（FR-APP-05/06 Phase 2）。
