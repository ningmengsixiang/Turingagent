# Phase 2 · 计划 13：统一任务看板增强（M2.2：拖拽 + 统计瓦片 + 日报周报）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强统一任务看板（M2.2，原型 board.html 落地）：卡片拖拽换状态（HTML5 DnD，人类+智能体混合任务统一操作）、统计瓦片增强（到期/阻塞/完成率）、日报周报生成（聚合任务 → 会话内发送文本消息）。保留既有按钮换状态路径（无障碍/触屏兜底）。

**Architecture:** 纯前端增强，零后端改动（复用 `PATCH /api/v1/tasks/:id/status` 与 `listTasks`）。拖拽：kanban-card 设 `draggable` + `onDragStart`（记录任务 id），kanban-column 设 `onDragOver preventDefault` + `onDrop`（调 `moveTaskFromBoard`）；统计瓦片：增「到期 X 天」「阻塞」「完成率」；日报/周报：按钮 → 聚合 tasks（按 assigneeKind 分人类/智能体、按状态分组）→ `sendMessage` 发一条文本消息（含 Markdown 列表）→ 刷新消息流。拖拽在 jsdom 用 `fireEvent.dragStart/drop` 测试。

**Tech Stack:** 无新依赖。React DnD 原生事件 + 既有 updateTaskStatus/listTasks/sendMessage。

**质量审查决策（T4 后追加）：** 拖拽用例断言真实化——原断言 `findByText(/🔄 进行中/)` 命中恒渲染的列头（空转）；修复为 mockFetch 增 tasks「PATCH 后状态」（patchedTasks 仿 createdMessages 模式）+ 断言 PATCH 调用 + `within(列).findByText(卡片)`（负向验证：禁用合并后用例失败，证明非空转）。日报用例链路真实（POST→重拉→渲染）。**记录 nit**：done 任务无 dueAt 被 `inRange` 排除（产品语义待确认，后续加强日报断言时用带 dueAt 的 mock）；日报断言只验前缀未验正文；messages 死占位 key 可清理。

**质量审查决策（T1-T3 后追加）：** ① 日报/周报范围改为「非 done 必入报 + done 按 dueAt 窗口过滤」——原按 dueAt 过滤会漏掉过期未完成任务（最该曝光的积压项）且无 dueAt 的已完成任务永久入报；② sendTaskReport 加 `if (busy) return` 守卫 + 按钮 disabled（防双击并发重复消息）；③ 报告行显示名用 AGENT_NAMES（与看板卡片一致）；④ 报告头日期本地拼装（原 UTC 在 UTC+8 早晨差一天）。**记录后续**：按钮误拖防护（onDragStart 判 closest('button')）、同列 drop 跳过 PATCH（幂等无害但冗余请求）、时区边界（UTC 时间戳 vs 本地 Date.now）、文件拖到看板列被吞（drop 判 dataTransfer.types 含 Files）、长报告截断（>10000 字符 400，当前负载低风险）、单布尔 busy 重构（计数/分域，与语音同问题）、拖拽中卡片卸载的 dragend 兜底。

**决策记录：** 拖拽用 HTML5 DnD（零依赖、与既有按钮并存）而非 dnd-kit（拖拽库记 Phase 2 后续，若需要动画/触摸增强再引入）；日报周报为「前端聚合 → 文本消息」轻量实现（真实报表/导出 PDF 记后续；智能体自动生成日报记后续任务）；统计瓦片增强不改后端（tasks 无 dueAt 聚合由前端算）；拖拽仅「状态变更」不重排（排序/优先级记后续）。权限：看板操作沿用既有（会话成员即可，服务端校验）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `apps/web/src/pages/Chat.tsx` | 修改 | 拖拽事件 + 统计瓦片增强 + 日报周报按钮/生成 |
| `apps/web/src/pages/Chat.test.tsx` | 修改 | 拖拽/统计/日报用例 |
| `apps/web/src/app.css` | 修改 | 拖拽视觉（dragging/over 高亮） |
| `README.md` | 修改 | 看板增强说明 |

---

## Task 1: 看板拖拽换状态

**Files:**
- Modify: `apps/web/src/pages/Chat.tsx`

- [ ] **Step 1: 拖拽事件**

读 `apps/web/src/pages/Chat.tsx` 看板渲染区（~:622-644），做三处修改：

1. 组件内增拖拽状态与 handler（在 `moveTaskFromBoard` 函数 ~:283 之后）：

```tsx
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null)

  function handleDragStart(taskId: string) {
    setDragTaskId(taskId)
  }
  function handleDragEnd() {
    setDragTaskId(null)
    setDragOverStatus(null)
  }
  function handleDrop(status: TaskStatus) {
    if (dragTaskId) void moveTaskFromBoard(dragTaskId, status)
    setDragTaskId(null)
    setDragOverStatus(null)
  }
```

2. 看板列（kanban-column div）增拖拽属性：

```tsx
                  <div
                    key={status}
                    className={`kanban-column ${dragOverStatus === status ? 'drag-over' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDragOverStatus(status)
                    }}
                    onDragLeave={() => setDragOverStatus((prev) => (prev === status ? null : prev))}
                    onDrop={(e) => {
                      e.preventDefault()
                      handleDrop(status)
                    }}
                  >
```

3. 看板卡片（kanban-card div）增 draggable：

```tsx
                      <div
                        key={t.id}
                        className={`kanban-card ${dragTaskId === t.id ? 'dragging' : ''}`}
                        draggable
                        onDragStart={() => handleDragStart(t.id)}
                        onDragEnd={handleDragEnd}
                      >
```

（保留既有按钮换状态区不变。）

- [ ] **Step 2: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose src/pages/Chat.test.tsx
```

Expected: typecheck exit 0；Chat.test.tsx 既有 17 用例全 PASS。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/pages/Chat.tsx
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(web): 看板拖拽换状态（HTML5 DnD）"
```

---

## Task 2: 统计瓦片增强

**Files:**
- Modify: `apps/web/src/pages/Chat.tsx`

- [ ] **Step 1: 增强统计瓦片**

读 `apps/web/src/pages/Chat.tsx` 统计区（~:616-621），把 4 个 stat 替换为：

```tsx
            <div className="kanban-stats">
              <span className="stat">{tasks.length} 总</span>
              <span className="stat">{tasks.filter((t) => t.status === 'in_progress').length} 进行中</span>
              <span className="stat">{tasks.filter((t) => t.status === 'blocked').length} 阻塞</span>
              <span className="stat">{tasks.filter((t) => t.status === 'done').length} 完成</span>
              <span className="stat">
                {tasks.length > 0 ? `${Math.round((tasks.filter((t) => t.status === 'done').length / tasks.length) * 100)}% 完成率` : '0% 完成率'}
              </span>
              <span className="stat">{tasks.filter((t) => t.assigneeKind === 'agent').length} 智能体</span>
              <span className="stat">
                {tasks.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < Date.now() && t.status !== 'done').length} 已到期
              </span>
            </div>
```

- [ ] **Step 2: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose src/pages/Chat.test.tsx
```

Expected: typecheck exit 0；既有 17 用例全 PASS。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/pages/Chat.tsx
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(web): 看板统计瓦片增强（阻塞/完成率/到期）"
```

---

## Task 3: 日报周报生成

**Files:**
- Modify: `apps/web/src/pages/Chat.tsx`

- [ ] **Step 1: 日报生成函数**

读 `apps/web/src/pages/Chat.tsx`，在 `moveTaskFromBoard` 之后增：

```tsx
  async function sendTaskReport(kind: 'daily' | 'weekly') {
    if (!activeId || tasks.length === 0) {
      setError('当前没有任务可汇总')
      return
    }
    const now = new Date()
    const rangeStart =
      kind === 'daily'
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
        : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
    const inRange = tasks.filter((t) => !t.dueAt || new Date(t.dueAt) >= rangeStart)
    const byStatus = (s: TaskStatus) => inRange.filter((t) => t.status === s)
    const line = (t: Task) => `- ${t.title}（${t.assigneeKind === 'agent' ? '🤖' : '👤'}${t.assigneeId}）`
    const lines = [
      `【${kind === 'daily' ? '日报' : '周报'}】${now.toISOString().slice(0, 10)}`,
      '',
      `✅ 完成 ${byStatus('done').length} 项：`,
      ...byStatus('done').map(line),
      `🔄 进行中 ${byStatus('in_progress').length} 项：`,
      ...byStatus('in_progress').map(line),
      `⛔ 阻塞 ${byStatus('blocked').length} 项：`,
      ...byStatus('blocked').map(line),
      `📋 待开始 ${byStatus('todo').length} 项：`,
      ...byStatus('todo').map(line),
    ].join('\n')
    try {
      setBusy(true)
      setError(null)
      const sessionId = await ensureSession()
      if (sessionId) {
        await sendMessage(sessionId, { clientMsgId: crypto.randomUUID(), contentType: 'text', content: lines })
        await loadMessages(sessionId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成报告失败')
    } finally {
      setBusy(false)
    }
  }
```

- [ ] **Step 2: 看板头部增按钮**

在 `kanban-stats` 之前（panel-head 内或统计后）增：

```tsx
            <div className="kanban-report-actions">
              <button className="ghost small" onClick={() => void sendTaskReport('daily')}>📅 日报</button>
              <button className="ghost small" onClick={() => void sendTaskReport('weekly')}>📆 周报</button>
            </div>
```

- [ ] **Step 3: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose src/pages/Chat.test.tsx
```

Expected: typecheck exit 0；既有 17 用例全 PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/pages/Chat.tsx
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(web): 日报/周报生成（任务聚合 → 会话消息）"
```

---

## Task 4: 测试 + CSS + README

**Files:**
- Modify: `apps/web/src/pages/Chat.test.tsx`
- Modify: `apps/web/src/app.css`
- Modify: `README.md`（根）

- [x] **Step 1: Chat.test.tsx 补用例**

读 `apps/web/src/pages/Chat.test.tsx`（mockFetch 风格、FakeWebSocket、既有用例），追加：

```tsx
  it('moves a task via drag and drop', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': { messages: [] },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [] },
      '/api/v1/sessions/s1/tasks': {
        tasks: [
          { id: 't1', sessionId: 's1', title: '写登录页', assigneeId: 'agent-ta-fullstack', assigneeKind: 'agent', status: 'todo' },
        ],
      },
      '/api/v1/tasks/t1/status': { task: { id: 't1', sessionId: 's1', title: '写登录页', assigneeId: 'agent-ta-fullstack', assigneeKind: 'agent', status: 'in_progress' } },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText(/写登录页/)).toBeTruthy()
    const card = screen.getByText(/写登录页/)
    const doneColumn = screen.getByText(/🔄 进行中/)
    fireEvent.dragStart(card.closest('.kanban-card')!)
    fireEvent.dragOver(doneColumn.closest('.kanban-column')!)
    fireEvent.drop(doneColumn.closest('.kanban-column')!)
    expect(await screen.findByText(/🔄 进行中/)).toBeTruthy()
  })

  it('sends a daily report message', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': { messages: [] },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [] },
      '/api/v1/sessions/s1/tasks': {
        tasks: [
          { id: 't1', sessionId: 's1', title: '写登录页', assigneeId: 'agent-ta-fullstack', assigneeKind: 'agent', status: 'done' },
        ],
      },
      '/api/v1/sessions/s1/messages': { message: { id: 'm9', clientMsgId: 'c9', sessionId: 's1', senderId: 'u-alice', senderKind: 'human', contentType: 'text', content: '【日报】', seq: 9, createdAt: '', ref: null } },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText(/写登录页/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /📅 日报/ }))
    expect(await screen.findByText(/【日报】/)).toBeTruthy()
  })
```

> 注：`mockFetch` 对 `PATCH /api/v1/tasks/t1/status` 的 key 形式——核对现有 mockFetch 是否区分 method（读现有实现；若 URL-only 查表，key 为 `/api/v1/tasks/t1/status`；若按 method+url 区分，用现有风格）。`sendMessage` 的 POST key 同理。`fireEvent` 已 import。dragOver 的 `setDragOverStatus` 触发后 drop 才能读到 dragTaskId——fireEvent 顺序 dragStart→dragOver→drop 即可。

- [x] **Step 2: app.css 增拖拽样式**

在 `.kanban-column` 相关样式后追加：

```css
.kanban-card.dragging { opacity: 0.4; }
.kanban-column.drag-over { outline: 2px dashed #4a7dff; background: rgba(74, 125, 255, 0.06); }
.kanban-report-actions { display: flex; gap: 6px; padding: 0 0 8px; }
```

- [x] **Step 3: README 增「看板增强」节**

在 README「### 多级审批（FR-APP-02）」节之后追加：

```markdown
### 任务看板增强（M2.2）

看板卡片支持拖拽换状态（HTML5 DnD，保留按钮换状态兜底）；统计瓦片含完成率、阻塞、已到期；📅 日报 / 📆 周报按钮把当前会话任务按状态聚合为文本消息发送到会话（人类+智能体混合任务统一展示）。
```

- [x] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose
pnpm --filter @ta/web build
```

Expected: typecheck exit 0；web 测试全 PASS（17 + 2 新增 = 19）；build 产出 dist/。

- [x] **Step 5: 提交**

```bash
git add apps/web/src/pages/Chat.test.tsx apps/web/src/app.css README.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(web): 看板拖拽测试 + 样式 + README 增强说明"
```

---

## Task 5: 全仓验收 + 推送 + 真实验收

- [ ] **Step 1: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
```

Expected: build 全过；test 全绿（contracts 2 + gateway 164 + web 19 ≈ 185）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净（除 README/计划文档）。

- [ ] **Step 2: 真实验收（拖拽后端链路 + 日报消息）**

拖拽与日报为前端交互，浏览器手动验收标注；curl 验收后端链路：

```bash
cd /tmp
# 1) 登录建会话 → 创建任务（POST /sessions/:id/tasks）
# 2) PATCH /tasks/:id/status 换状态（拖拽的最终动作）→ 验证 200 与任务状态更新
# 3) GET /sessions/:id/tasks 验证列表含更新
# 4) 发一条日报文本消息（模拟前端 sendTaskReport 的 sendMessage 调用）→ 验证消息入流
```

Expected: 任务创建/换状态/列表一致；日报消息入流（seq 递增）。

- [ ] **Step 3: 提交 + 推送**

```bash
git add README.md docs/superpowers/plans/2026-08-15-phase2-plan2-kanban-enhance.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 13 全部勾选 + README 看板增强说明"
git push
```

Expected: 推送成功。

---

## Self-Review 记录

- **Spec 覆盖**：M2.2（人类+智能体混合看板→既有 + 拖拽统一操作；拖拽→Task 1；统计瓦片→Task 2；日报周报→Task 3；原型 board.html 落地→Task 1-3 前端增强）。FR-CHAT-01 消息发送链路复用（日报走 text 消息）。
- **占位符扫描**：无 TBD；代码逐字给出。
- **类型一致性**：`TaskStatus`（todo/in_progress/blocked/done）在契约/看板渲染/dragOverStatus state/moveTaskFromBoard 一致；`sendTaskReport` 的 `kind: 'daily' | 'weekly'` 判别一致；`Task` 的 dueAt 可选字段处理（`t.dueAt && new Date(...)`）安全。
- **已知取舍**：拖拽仅换状态不重排（排序记后续）；日报周报前端聚合文本消息（真实报表/智能体自动生成记后续）；无 dnd-kit（零依赖，触摸/动画增强记后续）；统计瓦片前端算（无后端聚合）。
