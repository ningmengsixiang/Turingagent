# Phase 1 · 计划 8：记忆自动沉淀（LLM 摘要）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 FR-MEM-01 的「自动沉淀」：一键把会话最近讨论经 LLM 摘要为结构化记忆文档（需求/决策/待办），写入记忆（版本留痕），前端「沉淀」按钮触发。复用既有模型网关（DeepSeek）与记忆仓储。

**Architecture:** 后端：`POST /api/v1/sessions/:id/memories/summarize`——取最近 50 条人类+智能体消息（纯文本），调模型 provider（摘要 prompt），生成 `{title, content}`（内容含「需求基线/关键决策/待办事项/未决问题」小节），创建或更新「会话记忆 <日期>」记忆（若当天已有则更新为新版本）。server.ts 把 `provider` 注入 memory 路由（与 bridge 同源）。前端：记忆区块加「沉淀」按钮 → 调 API → 刷新列表。

**Tech Stack:** 既有（Fastify + pg + vitest + React + model provider）；无新依赖；摘要 prompt 内置常量。

**决策记录：** 触发 = 显式按钮（非自动监听每消息——克制发言 PR-5 与成本 PR-6）；摘要范围 = 最近 50 条文本消息（跳卡片）；记忆标题 = `会话记忆 <YYYY-MM-DD>`（当天重复沉淀 → 更新同一记忆的新版本，版本留痕天然表达「每日快照」）；模型失败 → 500 透出（前端提示重试）；provider 未配置（agentEnabled=false）→ 503。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/src/agent/memory-summary.ts` | 创建 | 摘要 prompt 常量 + 消息收集 |
| `services/gateway/src/routes/memories.ts` | 修改 | 增 summarize 路由 |
| `services/gateway/src/server.ts` | 修改 | 注入 provider |
| `services/gateway/src/routes/memories.test.ts` | 修改 | summarize 用例 |
| `apps/web/src/api/client.ts` | 修改 | summarizeMemory API |
| `apps/web/src/pages/Chat.tsx` | 修改 | 沉淀按钮 |
| `apps/web/src/pages/Chat.test.tsx` | 修改 | 沉淀用例 |
| `README.md` | 修改 | 沉淀说明 |

## Task 1: 后端 summarize

**Files:**
- Create: `services/gateway/src/agent/memory-summary.ts`
- Modify: `services/gateway/src/routes/memories.ts`
- Modify: `services/gateway/src/server.ts`
- Modify: `services/gateway/src/routes/memories.test.ts`

- [ ] **Step 1: 写 memory-summary.ts**

```ts
import type { Message } from '@ta/contracts'

export const MEMORY_SUMMARY_PROMPT = `你是 Turing Agent 的记忆沉淀助手。请把以下会话讨论整理成结构化记忆文档，包含四个小节：
1. 需求基线（明确的需求与范围）
2. 关键决策（讨论中确定的决策）
3. 待办事项（未完成的行动项）
4. 未决问题（讨论中未解决的疑问）

要求：简洁、要点化、中文；只总结讨论中实际出现的内容，不臆造。以下是会话消息（格式：发送者: 内容）：`

const MAX_MESSAGES = 50

/** 收集会话最近文本消息（跳过卡片），格式化为摘要输入 */
export function collectMessagesForSummary(messages: Message[]): string {
  const recent = messages
    .filter((m) => m.contentType === 'text')
    .slice(-MAX_MESSAGES)
  if (recent.length === 0) return ''
  return recent.map((m) => `${m.senderKind === 'agent' ? m.senderId : m.senderId}: ${m.content}`).join('\n')
}

export function buildSummaryPrompt(transcript: string): string {
  return `${MEMORY_SUMMARY_PROMPT}\n${transcript}`
}

export function memoryTitleForToday(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `会话记忆 ${y}-${m}-${d}`
}
```

- [ ] **Step 2: 修改 routes/memories.ts（增 summarize 路由）**

1. 签名增 provider 参数：`registerMemoryRoutes(app, config, pool, provider: ModelProvider | null)`——`ModelProvider` 从 '../model/provider.js' import。
2. 追加路由：

```ts
  app.post<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/memories/summarize',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      if (!UUID_PATTERN.test(sessionId)) {
        return reply.code(400).send({ error: 'session id must be a uuid' })
      }
      const userId = request.user!.id
      if (!(await isMember(pool, sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      if (!provider) {
        return reply.code(503).send({ error: 'agent disabled: model provider not configured' })
      }
      const recent = await listRecentTextMessages(pool, sessionId)
      const transcript = collectMessagesForSummary(recent)
      if (!transcript) {
        return reply.code(400).send({ error: 'no text messages to summarize' })
      }
      const completion = await provider.complete(MEMORY_SUMMARY_PROMPT, transcript)
      const title = memoryTitleForToday()
      // 当天已有该标题记忆则更新为新版本，否则新建
      const existing = await findMemoryByTitle(pool, sessionId, title)
      let memory
      if (existing) {
        memory = await updateMemoryContent(pool, { id: existing.id, content: completion.content, editedBy: userId })
      } else {
        memory = await createMemory(pool, { sessionId, title, content: completion.content, createdBy: userId })
      }
      return { memory }
    },
  )
```

3. 辅助函数（文件底部）：

```ts
async function listRecentTextMessages(pool: pg.Pool, sessionId: string) {
  const res = await pool.query(
    'SELECT * FROM messages WHERE session_id = $1 AND content_type = $2 ORDER BY seq DESC LIMIT 50',
    [sessionId, 'text'],
  )
  return res.rows
    .reverse()
    .map((r) => ({ id: r.id, clientMsgId: r.client_msg_id, sessionId: r.session_id, senderId: r.sender_id, senderKind: r.sender_kind, contentType: r.content_type, content: r.content, seq: Number(r.seq), createdAt: r.created_at.toISOString() }) as Message)
}

async function findMemoryByTitle(pool: pg.Pool, sessionId: string, title: string) {
  const res = await pool.query('SELECT * FROM memories WHERE session_id = $1 AND title = $2 ORDER BY updated_at DESC LIMIT 1', [sessionId, title])
  return res.rows[0] ? (await import('../repos/memories.js')).getMemory(pool, res.rows[0].id) : null
}
```

> 注：`listRecentTextMessages` 的行映射可复用 `mapMessage`（从 '../repos/messages.js' import 导出）——若 mapMessage 已导出则直接 `res.rows.map(mapMessage)`，以类型正确为准。

- [ ] **Step 3: 修改 server.ts（注入 provider）**

`registerMemoryRoutes(app, config, pool)` 改为 `registerMemoryRoutes(app, config, pool, provider)`——注意 provider 变量在 bridge 创建处定义（`const provider = deps?.provider ?? createModelProvider(config)`），需在 registerMemoryRoutes 调用**之前**定义（把 provider 创建移到路由注册前，或把 registerMemoryRoutes 移到 provider 定义之后）。以可编译为准。

- [ ] **Step 4: 测试（memories.test.ts 追加）**

```ts
  it('summarizes session messages into a memory', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    // 造几条消息
    for (const [i, content] of ['需要报销系统', '支持差旅类型', '审批流要两级'].entries()) {
      await built.app.inject({
        method: 'POST',
        url: `/api/v1/sessions/${sessionId}/messages`,
        headers: { authorization: `Bearer ${alice}` },
        payload: { clientMsgId: `sum-${i}`, contentType: 'text', content },
      })
    }
    // 用 stub provider 注入——buildApp 需支持
    ...
  })
```

> 注：summarize 依赖 provider——测试需 `buildApp({...}, { provider: new StubProvider('【需求基线】\n- 报销系统\n【关键决策】\n- 两级审批') })`。检查 buildApp 是否已支持 deps.provider（计划 3 已实现）——若支持，直接传；既有 memories.test.ts 的 `buildApp({ databaseUrl })` 不传 provider → provider null → summarize 503。**新增用例用带 provider 的 buildApp**。既有用例不变。

- [ ] **Step 5: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；新增 summarize 用例全 PASS；既有用例不回归。

- [ ] **Step 6: 提交**

```bash
git add services/gateway
git commit -m "feat(memory): 记忆自动沉淀（LLM 摘要路由）"
```

## Task 2: 前端沉淀按钮

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/Chat.tsx`
- Modify: `apps/web/src/pages/Chat.test.tsx`

- [ ] **Step 1: client.ts 增 summarizeMemory**

```ts
export const summarizeMemory = (sessionId: string): Promise<{ memory: Memory }> =>
  request(`/api/v1/sessions/${sessionId}/memories/summarize`, { method: 'POST' })
```

- [ ] **Step 2: Chat.tsx 记忆区块加沉淀按钮**

memory-head 的「＋」按钮旁加：

```tsx
            <button className="ghost" onClick={() => void summarize()}>沉淀</button>
```

summarize 函数：

```tsx
  const [summarizing, setSummarizing] = useState(false)

  async function summarize() {
    if (!activeId || summarizing) return
    setSummarizing(true)
    setError(null)
    try {
      await summarizeMemory(activeId)
      const res = await listMemories(activeId)
      setMemories(res.memories)
    } catch (err) {
      setError(err instanceof Error ? err.message : '沉淀失败')
    } finally {
      setSummarizing(false)
    }
  }
```

- [ ] **Step 3: Chat.test.tsx 补用例**

```tsx
  it('summarizes memories via the button', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': { messages: [] },
      '/api/v1/sessions/s1/memories': { memories: [{ id: 'mem1', sessionId: 's1', title: '会话记忆 2026-08-16', content: '【需求基线】…', currentVersion: 1, createdBy: 'u-alice', createdAt: '', updatedAt: '' }] },
      '/api/v1/sessions/s1/members': { members: [{ userId: 'u-alice', name: 'alice', kind: 'human' }] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
      '/api/v1/sessions/s1/memories/summarize': { memory: { id: 'mem1', sessionId: 's1', title: '会话记忆 2026-08-16', content: '【需求基线】…', currentVersion: 2, createdBy: 'u-alice', createdAt: '', updatedAt: '' } },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText('会话记忆 2026-08-16')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /沉淀/ }))
    await waitFor(() => expect(screen.getByText('会话记忆 2026-08-16')).toBeTruthy())
  })
```

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose
pnpm --filter @ta/web build
```

Expected: typecheck exit 0；web 测试 18 用例全 PASS；build 产出 dist/。

- [ ] **Step 5: 提交**

```bash
git add apps/web
git commit -m "feat(web): 记忆沉淀按钮"
```

## Task 3: 收尾（README + 全仓验收 + 推送）

**Files:**
- Modify: `README.md`（根）

- [ ] **Step 1: README 更新「记忆文档」节**

在「### 记忆文档」节的 curl 示例之后追加：

```markdown
# 一键沉淀：LLM 摘要会话讨论为结构化记忆（需求/决策/待办/未决）
curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/memories/summarize \
  -H "authorization: Bearer $TOKEN"
# → 生成/更新「会话记忆 <日期>」，版本留痕；需配置 MODEL_API_KEY
```

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm build
pnpm test
pnpm install --frozen-lockfile
```

Expected: build 全过；test 全绿（contracts 2 + gateway ~123 + web 18 = ~143）；frozen-lockfile 通过；`git status` 干净（除 README）。

- [ ] **Step 3: 提交 + 推送**

```bash
git add README.md
git commit -m "docs: README 补记忆自动沉淀说明"
git push
```

Expected: 推送成功。

---

## Self-Review 记录（写完后自查）

- **Spec 覆盖**：FR-MEM-01（记忆自动沉淀）→ Task 1/2；PR-6（成本：显式触发 + 单次摘要）→ 决策；PR-5（克制：不自动监听）→ 决策。
- **占位符扫描**：无 TBD；listRecentTextMessages 的映射注明可复用 mapMessage。
- **类型一致性**：`ModelProvider` 在 server/memories 路由一致；`summarizeMemory` 在 client/路由一致；`memoryTitleForToday` 在 repo 辅助/路由一致。
- **已知取舍**：摘要范围最近 50 条文本；当天重复沉淀更新同一记忆；无自动定时沉淀；摘要 prompt 无用户自定义模板。
