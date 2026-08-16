# Phase 1 · 计划 7：右侧看板面板（三栏工作台核心）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地三栏工作台的**右侧上下文面板·看板**（路线图 M1.1 的核心可演示部分 + BL-3 看板雏形）：会话任务按状态四列分组展示、点击流转、统计瓦片（总数/进行中/已完成/智能体任务占比）——与聊天流中的任务卡实时同步（任务卡流转经 WS 后看板刷新）。

**Architecture:** 纯前端增量（后端已有 `GET /sessions/:id/tasks`、`PATCH /tasks/:id/status`、WS `message.updated`）：Chat 组件增右栏（`chat-panel`），`activeId` 变化时 `listTasks` 加载 + 监听 `message.updated` 刷新；任务按 `status` 分四列渲染，点击流转按钮调 `updateTaskStatus`；统计瓦片实时计算。

**Tech Stack:** 既有（React + vitest）；无后端改动；布局 = 左侧栏 + 中间消息 + 右侧看板（`<1280px` 时右栏可折叠，参照原型响应式约定）。

**决策记录：** 看板数据 = `listTasks` 全量重拉（每次流转/WS 更新后）——任务量小，简单正确；列标题用契约状态标签（📋待开始/🔄进行中/⛔已阻塞/✅已完成，与 taskCardContent 同构）；统计瓦片：总数/进行中/已完成/agent 任务数；拖拽排序 Phase 2（完整看板）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `apps/web/src/pages/Chat.tsx` | 修改 | 三栏布局（右栏看板面板） |
| `apps/web/src/pages/Chat.test.tsx` | 修改 | 看板用例 |
| `apps/web/src/app.css` | 修改 | 看板样式 |
| `README.md` | 修改 | 看板说明 |

## Task 1: 前端看板面板

**Files:**
- Modify: `apps/web/src/pages/Chat.tsx`
- Modify: `apps/web/src/app.css`
- Modify: `apps/web/src/pages/Chat.test.tsx`

- [ ] **Step 1: Chat.tsx 增看板状态与加载**

1. import 增 `Task` 类型与 `listTasks`（client 已有 listTasks）。

2. 状态增：

```tsx
  const [tasks, setTasks] = useState<Task[]>([])
  const [panelOpen, setPanelOpen] = useState(true)
```

3. loadTasks 函数：

```tsx
  const loadTasks = useCallback(async (sessionId: string) => {
    try {
      const res = await listTasks(sessionId)
      setTasks(res.tasks)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载任务失败')
    }
  }, [])
```

4. activeId effect 增 loadTasks。

5. WS 事件处理：`message.updated` 分支（若更新的消息是 task_card，刷新任务列表）——在 message.updated 处理里加：

```tsx
          if (ev.type === 'message.updated' && ev.message) {
            if (ev.message.sessionId === activeIdRef.current) {
              setMessages((prev) => prev.map((m) => (m.id === ev.message!.id ? ev.message! : m)))
              if (ev.message.contentType === 'task_card') void loadTasks(ev.message.sessionId)
            }
          }
```

6. 看板流转函数（复用 moveTask 逻辑——看板点击直接调 updateTaskStatus 并刷新）：

```tsx
  async function moveTaskFromBoard(taskId: string, status: TaskStatus) {
    setError(null)
    try {
      await updateTaskStatus(taskId, status)
      await loadTasks(activeId!)
      await loadMessages(activeId!)
    } catch (err) {
      setError(err instanceof Error ? err.message : '任务更新失败')
    }
  }
```

- [ ] **Step 2: 布局三栏 + 看板渲染**

1. 根布局改为：`chat-layout` 内含 `session-sidebar` + `chat-main` + `chat-panel`。在 `</main>` 之后、`</div>` 之前加右栏：

```tsx
      <aside className={`chat-panel ${panelOpen ? '' : 'collapsed'}`}>
        <div className="panel-head">
          <strong>看板</strong>
          <button className="ghost" onClick={() => setPanelOpen((v) => !v)}>{panelOpen ? '收起' : '展开'}</button>
        </div>
        {panelOpen && (
          <>
            <div className="kanban-stats">
              <span className="stat">{tasks.length} 总</span>
              <span className="stat">{tasks.filter((t) => t.status === 'in_progress').length} 进行中</span>
              <span className="stat">{tasks.filter((t) => t.status === 'done').length} 完成</span>
              <span className="stat">{tasks.filter((t) => t.assigneeKind === 'agent').length} 智能体</span>
            </div>
            <div className="kanban-columns">
              {(['todo', 'in_progress', 'blocked', 'done'] as TaskStatus[]).map((status) => {
                const label = { todo: '📋 待开始', in_progress: '🔄 进行中', blocked: '⛔ 已阻塞', done: '✅ 已完成' }[status]
                const columnTasks = tasks.filter((t) => t.status === status)
                return (
                  <div key={status} className="kanban-column">
                    <div className="kanban-column-head">{label} <span className="count">{columnTasks.length}</span></div>
                    {columnTasks.map((t) => (
                      <div key={t.id} className="kanban-card">
                        <div className="kanban-card-title">{t.title}</div>
                        <div className="kanban-card-assignee">
                          {t.assigneeKind === 'agent' ? `🤖 ${AGENT_NAMES[t.assigneeId] ?? t.assigneeId}` : t.assigneeId}
                        </div>
                        <div className="kanban-card-actions">
                          {(['todo', 'in_progress', 'blocked', 'done'] as TaskStatus[]).map((s) => (
                            <button key={s} className="ghost small" onClick={() => void moveTaskFromBoard(t.id, s)}>
                              {s === 'todo' ? '待开始' : s === 'in_progress' ? '进行中' : s === 'blocked' ? '阻塞' : '完成'}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {columnTasks.length === 0 && <div className="kanban-empty">空</div>}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </aside>
```

- [ ] **Step 3: app.css 增看板样式**

```css
.chat-layout { display: flex; height: 100vh; }
.chat-panel { width: 280px; background: #f5f5f7; border-left: 1px solid #e5e5ea; display: flex; flex-direction: column; padding: 12px; gap: 10px; overflow-y: auto; }
.chat-panel.collapsed { width: 40px; padding: 8px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; }
.panel-head strong { font-size: 14px; }
.kanban-stats { display: flex; gap: 6px; flex-wrap: wrap; }
.stat { background: #fff; border: 1px solid #e5e5ea; border-radius: 8px; padding: 3px 8px; font-size: 12px; }
.kanban-columns { display: flex; flex-direction: column; gap: 8px; }
.kanban-column { background: #fff; border: 1px solid #e5e5ea; border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.kanban-column-head { font-size: 13px; font-weight: 600; display: flex; justify-content: space-between; }
.kanban-column-head .count { color: #6e6e73; }
.kanban-card { border: 1px solid #e5e5ea; border-radius: 8px; padding: 8px; font-size: 13px; display: flex; flex-direction: column; gap: 4px; }
.kanban-card-title { font-weight: 500; }
.kanban-card-assignee { font-size: 11px; color: #6e6e73; }
.kanban-card-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.kanban-empty { font-size: 12px; color: #c7c7cc; text-align: center; padding: 6px 0; }
```

- [ ] **Step 4: Chat.test.tsx 补看板用例**

在「renders members and a reply preview」用例之后追加：

```tsx
  it('renders the kanban panel grouped by status', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': { messages: [] },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [{ userId: 'u-alice', name: 'alice', kind: 'human' }] },
      '/api/v1/sessions/s1/tasks': {
        tasks: [
          { id: 't1', sessionId: 's1', title: '支付网关', assigneeId: 'agent-ta-fullstack', assigneeKind: 'agent', status: 'in_progress' },
          { id: 't2', sessionId: 's1', title: '导出功能', assigneeId: 'u-bob', assigneeKind: 'human', status: 'done' },
        ],
      },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText('支付网关')).toBeTruthy()
    expect(screen.getByText('导出功能')).toBeTruthy()
    expect(screen.getByText('看板')).toBeTruthy()
    expect(screen.getByText(/1 进行中/)).toBeTruthy()
  })
```

（注意既有用例的 mock 可能因 Chat 挂载时新增 `listTasks` 请求而失败——若报 unmocked fetch，需要给既有用例补 `'/api/v1/sessions/s1/tasks': { tasks: [] }`。检查并补齐。）

- [ ] **Step 5: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose
pnpm --filter @ta/web build
```

Expected: typecheck exit 0；web 测试 17 用例全 PASS；build 产出 dist/。

- [ ] **Step 6: 提交**

```bash
git add apps/web
git commit -m "feat(web): 右侧看板面板（分组/流转/统计）"
```

## Task 2: 收尾（README + 全仓验收 + 推送）

**Files:**
- Modify: `README.md`（根）

- [ ] **Step 1: README 补「看板」说明**

在「### 群聊协作」之后追加：

```markdown
### 任务看板

Web 右侧上下文面板提供会话任务看板：按状态（待开始/进行中/已阻塞/已完成）四列分组，点击卡片上的状态按钮流转，与聊天流中的任务卡实时同步；顶部统计瓦片展示总数/进行中/已完成/智能体任务占比。
```

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm build
pnpm test
pnpm install --frozen-lockfile
```

Expected: build 全过；test 全绿（contracts 2 + gateway 121 + web 17 = 140）；frozen-lockfile 通过；`git status` 干净（除 README）。

- [ ] **Step 3: 提交 + 推送**

```bash
git add README.md
git commit -m "docs: README 补任务看板说明"
git push
```

Expected: 推送成功。

---

## Self-Review 记录（写完后自查）

- **Spec 覆盖**：路线图 M1.1（三栏工作台的核心：右侧上下文面板）→ Task 1；BL-3 看板雏形（M2.2 的轻量版）→ Task 1；统计瓦片 → Task 1。
- **占位符扫描**：无 TBD；既有用例 mock 补充注明。
- **类型一致性**：`TaskStatus` 四列在 Chat.tsx/测试一致；`listTasks`/`updateTaskStatus` 复用 client API；AGENT_NAMES 复用。
- **已知取舍**：拖拽排序 Phase 2；看板每次全量重拉（简单正确）；右栏 <1280px 折叠（响应式保留）；交付物/进度 Tab Phase 1 后期。
