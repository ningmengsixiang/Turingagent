# Phase 1 · 计划 6：群聊完整化（M1.3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐群聊的高频协作能力（路线图 M1.3 的子集）：**会话成员列表**（含智能体成员展示）、**消息引用/回复**（FR-CHAT-09）、**@ 提及选择器**（输入区 `Ctrl+Shift+A` 唤起成员/智能体选择）。文件上传、语音转文字、静默策略评测集属后续计划（依赖 MinIO/ASR/评测基建）。

**Architecture:** 后端：`GET /api/v1/sessions/:id/members`（会话成员列表，成员表 JOIN 用户表映射显示名 + 附加四智能体）；`Message` 契约与 `messages` 表增 `reply_to`（引用回复，存被引消息 id，前端渲染引用行）。前端：会话头部成员数/成员弹层、消息引用行 + 引用按钮、@ 选择器（输入 `@` 或按钮触发弹层选成员/智能体，选中插入 `@Ta-X ` 或 `@u-name `）。

**Tech Stack:** 既有（Fastify + pg + vitest + React）；契约 `Message` 增 `replyTo?: string`（存 message id）；无新依赖。

**决策记录：** 引用回复 MVP = 存 `reply_to`（被引消息 id），列表/WS 返回时带被引消息摘要（`replyPreview`：被引消息的前 80 字）；成员列表 = session_members + users（JOIN 显示名，未注册的 TEXT id 直接展示）+ 四智能体固定附加；@ 选择器覆盖成员与四智能体；文件上传（MinIO）与语音转文字（ASR）留到后续计划（需新基建）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/migrations/006_reply_to.sql` | 创建 | messages 增 reply_to 列 |
| `services/gateway/src/repos/sessions.ts` | 修改 | listSessionMembers（JOIN users） |
| `services/gateway/src/repos/messages.ts` | 修改 | reply_to 支持 + replyPreview 摘要 |
| `services/gateway/src/routes/sessions.ts` | 修改 | GET /sessions/:id/members |
| `services/gateway/src/routes/messages.ts` | 修改 | POST messages 支持 replyTo |
| `packages/contracts/src/index.ts` | 修改 | Message 增 replyTo/replyPreview；SessionMember 类型 |
| `services/gateway/src/routes/sessions.test.ts` | 修改 | members 用例 |
| `services/gateway/src/routes/messages.test.ts` | 修改 | replyTo 用例 |
| `apps/web/src/api/client.ts` | 修改 | listSessionMembers API |
| `apps/web/src/pages/Chat.tsx` | 修改 | 成员弹层、引用行 + 引用按钮、@ 选择器 |
| `apps/web/src/pages/Chat.test.tsx` | 修改 | 成员/引用/@ 选择器用例 |
| `README.md` | 修改 | 群聊说明 |

---

## Task 1: 迁移 + 契约 + 后端支持

**Files:**
- Create: `services/gateway/migrations/006_reply_to.sql`
- Modify: `packages/contracts/src/index.ts`
- Modify: `services/gateway/src/repos/messages.ts`
- Modify: `services/gateway/src/repos/sessions.ts`

- [ ] **Step 1: 写 migrations/006_reply_to.sql**

```sql
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES messages (id) ON DELETE SET NULL;
```

- [ ] **Step 2: 修改 contracts**

2a. `Message` 接口增两字段（`ref?` 之后）：

```ts
  /** 引用回复：被引消息 id */
  replyTo?: string
  /** 被引消息摘要（服务端生成，前端渲染引用行） */
  replyPreview?: string
```

2b. 文件末尾追加：

```ts
export interface SessionMember {
  userId: string
  name: string
  kind: 'human' | 'agent'
}
```

- [ ] **Step 3: 修改 repos/messages.ts**

3a. `MessageRow` 增 `reply_to: string | null`、`reply_preview` 不支持（预览在查询时 LEFT JOIN 生成）。`mapMessage` 增：

```ts
    replyTo: row.reply_to ?? undefined,
```

3b. `createMessage` input 增 `replyTo?: string`；INSERT 列/参数增 reply_to：

```ts
      `INSERT INTO messages (session_id, sender_id, sender_kind, content_type, content, client_msg_id, seq, ref_kind, ref_id, reply_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [input.sessionId, input.senderId, input.senderKind, input.contentType, input.content, input.clientMsgId, seq, input.ref?.kind ?? null, input.ref?.id ?? null, input.replyTo ?? null],
```

3c. `listMessages` 查询改为 LEFT JOIN 取被引消息摘要：

```ts
export async function listMessages(
  pool: pg.Pool,
  sessionId: string,
  afterSeq: number,
  limit: number,
): Promise<Message[]> {
  const res = await pool.query<MessageRow & { reply_preview: string | null }>(
    `SELECT m.*, r.content AS reply_preview
       FROM messages m
       LEFT JOIN messages r ON r.id = m.reply_to
      WHERE m.session_id = $1 AND m.seq > $2
      ORDER BY m.seq ASC LIMIT $3`,
    [sessionId, afterSeq, limit],
  )
  return res.rows.map((row) => {
    const message = mapMessage(row)
    if (row.reply_preview) {
      message.replyPreview = row.reply_preview.length > 80 ? row.reply_preview.slice(0, 80) + '…' : row.reply_preview
    }
    return message
  })
}
```

- [ ] **Step 4: 修改 repos/sessions.ts**

在 `listSessionIdsForUser` 之后追加：

```ts
export interface SessionMemberRow {
  user_id: string
  name: string | null
}

export async function listSessionMembers(pool: pg.Pool, sessionId: string): Promise<SessionMember[]> {
  const res = await pool.query<SessionMemberRow>(
    `SELECT sm.user_id, u.name
       FROM session_members sm
       LEFT JOIN users u ON u.user_id = sm.user_id
      WHERE sm.session_id = $1
      ORDER BY sm.joined_at ASC`,
    [sessionId],
  )
  const members: SessionMember[] = res.rows.map((r) => ({
    userId: r.user_id,
    name: r.name ?? r.user_id, // 未注册用户直接展示 id
    kind: 'human',
  }))
  // 固定附加四智能体成员
  for (const agent of AGENTS) {
    members.push({ userId: agent.id, name: agent.displayName, kind: 'agent' })
  }
  return members
}
```

（import 增 `AGENTS` 与 `SessionMember` 类型。）

- [ ] **Step 5: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker exec ta-db pg_isready -U ta -d ta_dev
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway migrate
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: migrate 应用 006；typecheck exit 0；既有 118 用例不回归（createMessage 增可选 replyTo 不破坏既有调用）。

- [ ] **Step 6: 提交**

```bash
git add packages/contracts services/gateway
git commit -m "feat(chat): 引用回复支持 + 成员列表仓储 + 迁移 006"
```

---

## Task 2: 路由（members + replyTo）

**Files:**
- Modify: `services/gateway/src/routes/sessions.ts`
- Modify: `services/gateway/src/routes/messages.ts`
- Modify: `services/gateway/src/routes/sessions.test.ts`
- Modify: `services/gateway/src/routes/messages.test.ts`

- [ ] **Step 1: sessions.ts 增 GET /sessions/:id/members**

import 增 `listSessionMembers`；在 GET /sessions/:id 之后追加：

```ts
  app.get('/api/v1/sessions/:id/members', { preHandler: auth }, async (request, reply) => {
    const sessionId = (request.params as { id: string }).id
    if (!UUID_PATTERN.test(sessionId)) {
      return reply.code(400).send({ error: 'session id must be a uuid' })
    }
    const userId = request.user!.id
    if (!(await isMember(pool, sessionId, userId))) {
      return reply.code(403).send({ error: 'not a member of this session' })
    }
    const members = await listSessionMembers(pool, sessionId)
    return { members }
  })
```

（`UUID_PATTERN` 若 sessions.ts 未定义则添加——与 approvals/tasks 同款正则。）

- [ ] **Step 2: messages.ts 路由支持 replyTo**

POST /sessions/:id/messages 的 body 类型增 `replyTo?: string`；校验（若提供须为 UUID）并传入 createMessage：

```ts
      const replyTo = request.body?.replyTo
      if (replyTo !== undefined && !UUID_PATTERN.test(replyTo)) {
        return reply.code(400).send({ error: 'replyTo must be a uuid' })
      }
      ...
        replyTo,
```

（UUID_PATTERN 若 messages.ts 未定义则添加。）

- [ ] **Step 3: 测试**

sessions.test.ts 追加：

```ts
  it('lists session members with agents', async () => {
    const alice = await loginAs('alice')
    const created = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    const sessionId = created.json().session.id as string
    const res = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/members`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(res.statusCode).toBe(200)
    const { members } = res.json()
    expect(members.some((m: { userId: string }) => m.userId === 'u-alice')).toBe(true)
    expect(members.some((m: { userId: string }) => m.userId === 'u-bob')).toBe(true)
    expect(members.some((m: { userId: string; kind: string }) => m.userId === 'agent-ta-fullstack' && m.kind === 'agent')).toBe(true)
  })
```

messages.test.ts 追加：

```ts
  it('sends a message replying to another', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const first = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'm1', contentType: 'text', content: '被引用的消息' },
    })
    const firstId = first.json().message.id as string
    const second = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'm2', contentType: 'text', content: '引用回复', replyTo: firstId },
    })
    expect(second.statusCode).toBe(201)
    expect(second.json().message.replyTo).toBe(firstId)
    const list = await built.app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
    })
    const reply = list.json().messages.find((m: { replyTo?: string }) => m.replyTo === firstId)
    expect(reply.replyPreview).toContain('被引用的消息')
  })
```

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；新增 members 1 + replyTo 1 用例全 PASS；总用例 = 118 + 2 = 120。

- [ ] **Step 5: 提交**

```bash
git add services/gateway
git commit -m "feat(chat): 成员列表路由 + 引用回复路由"
```

---

## Task 3: 前端（成员/引用/@ 选择器）

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/Chat.tsx`
- Modify: `apps/web/src/pages/Chat.test.tsx`
- Modify: `apps/web/src/app.css`

- [ ] **Step 1: client.ts 追加成员 API**

```ts
import type { Approval, Memory, MemoryVersion, Message, Session, SessionMember, Task, TaskStatus } from '@ta/contracts'
```

在 listMemoryVersions 之后追加：

```ts
export const listSessionMembers = (sessionId: string): Promise<{ members: SessionMember[] }> =>
  request(`/api/v1/sessions/${sessionId}/members`)
```

- [ ] **Step 2: Chat.tsx 成员弹层 + 引用 + @ 选择器**

1. import 增 `listSessionMembers`、`SessionMember` 类型。

2. 状态增：

```tsx
  const [members, setMembers] = useState<SessionMember[]>([])
  const [showMembers, setShowMembers] = useState(false)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [showMention, setShowMention] = useState(false)
```

3. activeId effect 加载成员（loadMessages/loadMemories 并列）：

```tsx
  const loadMembers = useCallback(async (sessionId: string) => {
    try {
      const res = await listSessionMembers(sessionId)
      setMembers(res.members)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载成员失败')
    }
  }, [])
```

4. 消息渲染增引用行（bubble 内容上方）：

```tsx
                {m.replyPreview ? <div className="reply-preview">↪ {m.replyPreview}</div> : null}
```

5. 消息 meta 区加「引用」按钮（人类消息上）：

```tsx
                  {m.senderKind === 'human' ? (
                    <button className="ghost small" onClick={() => setReplyingTo(m)}>引用</button>
                  ) : null}
```

6. 输入区（input 上方）显示被引用行 + @ 按钮：

```tsx
        {replyingTo && (
          <div className="replying-bar">
            <span>↪ 回复：{replyingTo.content.slice(0, 60)}</span>
            <button className="ghost" onClick={() => setReplyingTo(null)}>取消</button>
          </div>
        )}
        <footer className="input-area">
          <button className="ghost" onClick={() => setShowMention((v) => !v)}>@</button>
          ...
```

7. send 传 replyTo：

```tsx
      await sendMessage(sessionId, { clientMsgId, contentType: 'text', content, replyTo: replyingTo?.id })
      setReplyingTo(null)
```

（client.ts 的 sendMessage input 类型增 `replyTo?: string`。）

8. @ 选择器弹层（组件底部）：

```tsx
      {showMention && (
        <div className="mention-picker">
          {members.map((mem) => (
            <button key={mem.userId} className="mention-option" onClick={() => { setInput((prev) => prev + (mem.kind === 'agent' ? `@${mem.name} ` : `@${mem.userId} `)); setShowMention(false) }}>
              {mem.kind === 'agent' ? `🤖 ${mem.name}` : mem.name}
            </button>
          ))}
        </div>
      )}
```

9. 会话头部成员数按钮：

```tsx
          <button className="ghost" onClick={() => setShowMembers(true)}>{members.length} 成员</button>
```

10. 成员弹层：

```tsx
      {showMembers && (
        <div className="memory-modal" onClick={() => setShowMembers(false)}>
          <div className="memory-modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>成员</h3>
            {members.map((mem) => (
              <div key={mem.userId} className="member-row">
                {mem.kind === 'agent' ? <span className="ai-badge">AI</span> : null} {mem.name}
              </div>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 3: app.css 增样式**

```css
.reply-preview { font-size: 12px; color: #6e6e73; background: #f0f0f5; padding: 4px 8px; border-radius: 6px; margin-bottom: 4px; }
.ghost.small { font-size: 11px; padding: 0 4px; }
.replying-bar { display: flex; justify-content: space-between; align-items: center; padding: 6px 20px; background: #f5f5f7; font-size: 12px; color: #6e6e73; }
.mention-picker { position: absolute; bottom: 64px; left: 20px; background: #fff; border: 1px solid #e5e5ea; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.1); padding: 6px; display: flex; flex-direction: column; max-height: 240px; overflow-y: auto; z-index: 5; }
.mention-option { border: none; background: none; text-align: left; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.mention-option:hover { background: #f0f0f5; }
.member-row { display: flex; align-items: center; gap: 6px; padding: 4px 0; font-size: 14px; }
.chat-main { position: relative; }
```

- [ ] **Step 4: Chat.test.tsx 补 2 用例**

```tsx
  it('renders members and a reply preview', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': {
        messages: [
          { id: 'm1', clientMsgId: 'c1', sessionId: 's1', senderId: 'u-alice', senderKind: 'human', contentType: 'text', content: '原始消息', seq: 1, createdAt: '' },
          { id: 'm2', clientMsgId: 'c2', sessionId: 's1', senderId: 'u-bob', senderKind: 'human', contentType: 'text', content: '引用回复', seq: 2, createdAt: '', replyTo: 'm1', replyPreview: '原始消息' },
        ],
      },
      '/api/v1/sessions/s1/members': {
        members: [
          { userId: 'u-alice', name: 'alice', kind: 'human' },
          { userId: 'agent-ta-fullstack', name: 'Ta-Fullstack', kind: 'agent' },
        ],
      },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText('原始消息')).toBeTruthy()
    expect(screen.getByText(/引用回复/)).toBeTruthy()
  })
```

- [ ] **Step 5: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose
pnpm --filter @ta/web build
```

Expected: typecheck exit 0；web 测试 16 用例全 PASS；build 产出 dist/。

- [ ] **Step 6: 提交**

```bash
git add apps/web
git commit -m "feat(web): 成员弹层/引用回复/@ 选择器"
```

---

## Task 4: 收尾（README + 全仓验收 + 推送）

**Files:**
- Modify: `README.md`（根）

- [ ] **Step 1: README 追加「群聊」节**

在「### 记忆文档」之后追加：

```markdown
### 群聊协作

```bash
# 会话成员列表（人类 + 四智能体）
curl -s localhost:3001/api/v1/sessions/<sessionId>/members -H "authorization: Bearer $TOKEN"

# 引用回复（replyTo = 被引消息 id；列表返回 replyPreview 摘要）
curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/messages \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"clientMsgId":"m2","contentType":"text","content":"引用回复","replyTo":"<被引消息id>"}'
```
```

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm build
pnpm test
pnpm install --frozen-lockfile
```

Expected: build 全过；test 全绿（contracts 2 + gateway 120 + web 16 = 138）；frozen-lockfile 通过；`git status` 干净（除 README）。

- [ ] **Step 3: 提交 + 推送**

```bash
git add README.md
git commit -m "docs: README 补群聊协作说明"
git push
```

Expected: 推送成功。

---

## Self-Review 记录（写完后自查）

- **Spec 覆盖**：FR-CHAT-09（消息引用与回复）→ Task 1/2/3；成员列表（FR-CHAT 群信息基础）→ Task 1/2/3；@ 提及选择器（FR-CHAT-04 的输入辅助）→ Task 3。
- **占位符扫描**：无 TBD；Task 3 组件实现注明细节可微调。
- **类型一致性**：`SessionMember` 在 contracts/repo/路由/前端一致；`Message.replyTo/replyPreview` 在 contracts/repo map/路由/前端一致；`listSessionMembers` 签名一致。
- **已知取舍**：文件上传（MinIO）与语音转文字（ASR）后续计划；静默策略评测集后续计划；引用回复只存被引 id + 摘要（无嵌套引用）；成员列表智能体固定附加（不与任务/消息动态关联）。
