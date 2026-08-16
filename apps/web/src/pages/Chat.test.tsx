import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Chat } from './Chat.js'

// 语音：mock speech 模块注入可控 session（canRecord: true → 🎤 按钮渲染）。
// stop 的返回值在用例内用 mockResolvedValueOnce 覆盖；默认返回空 audio，
// 因为组件卸载 cleanup 也会调 stop()（speechRef.current?.stop().catch），
// 若无默认实现会得到 undefined.catch 报错（globals:true 下 RTL 自动卸载）。
const { mockStop, mockSpeechSession } = vi.hoisted(() => {
  const mockStop = vi.fn()
  return {
    mockStop,
    mockSpeechSession: {
      canRecord: true,
      start: vi.fn(),
      stop: mockStop.mockImplementation(async () => ({ kind: 'audio', blob: new Blob([]), mime: 'audio/webm' })),
    },
  }
})

vi.mock('../lib/speech.js', () => ({
  createSpeechSession: () => mockSpeechSession,
}))

// jsdom 未实现 Element.setPointerCapture（Chat onPointerDown 会调用）→ 测试环境补 no-op
if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  close(): void {
    this.closed = true
    this.onclose?.()
  }
}

function mockFetch(routes: Record<string, unknown>) {
  // 精确匹配：子串匹配会让 /api/v1/sessions 吞掉 /sessions/:id/messages
  // 发送走 POST → 服务端记录 → 组件重拉 after_seq 增量；模拟后端存下已发消息，
  // 否则发送后重拉永远返回空列表（静态路由无法表达"发送后"的状态）
  const createdMessages: Array<Record<string, unknown>> = []
  // PATCH 状态变更同款：记录被改状态的任务，GET tasks 时按 id 覆盖种子，
  // 否则拖拽改状态后重拉永远返回旧状态（静态路由无法表达"改状态后"的状态）
  const patchedTasks: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'POST' && /\/messages$/.test(url)) {
      const input = JSON.parse(String(init?.body ?? '{}')) as {
        clientMsgId?: string
        contentType?: string
        content?: string
      }
      const message = { id: `m-${createdMessages.length + 1}`, ...input, seq: createdMessages.length + 1 }
      createdMessages.push(message)
      return { ok: true, status: 200, json: async () => ({ message }) }
    }
    if (method === 'POST' && /\/files$/.test(url)) {
      // 语音降级走文件上传（与 /messages POST 同款）：把返回的 message 推入 createdMessages，
      // 否则上传后重拉列表永远为空（静态路由无法表达"上传后"的状态）
      const body = (routes[url] ?? {}) as { message?: Record<string, unknown> }
      if (body.message) createdMessages.push(body.message)
      return { ok: true, status: 201, json: async () => body }
    }
    if (method === 'PATCH' && /\/tasks\/([^/]+)\/status$/.test(url)) {
      const taskId = /\/tasks\/([^/]+)\/status$/.exec(url)![1]
      const input = JSON.parse(String(init?.body ?? '{}')) as { status?: string }
      // 从会话 tasks 种子路由取原任务（保留 title/assignee 等字段）后覆盖 status；
      // 种子缺失时回退 PATCH 静态路由的 task（既有「status buttons」用例依赖该返回体）
      const tasksRoute = Object.values(routes).find(
        (v) => !!v && typeof v === 'object' && Array.isArray((v as { tasks?: unknown[] }).tasks),
      ) as { tasks: Array<Record<string, unknown>> } | undefined
      const fallback = (routes[url] as { task?: Record<string, unknown> } | undefined)?.task
      const seed = tasksRoute?.tasks.find((t) => t.id === taskId) ?? fallback ?? {}
      const task = { ...seed, id: taskId, status: input.status }
      const idx = patchedTasks.findIndex((t) => (t as { id?: string }).id === taskId)
      if (idx >= 0) patchedTasks[idx] = task
      else patchedTasks.push(task)
      return { ok: true, status: 200, json: async () => ({ task }) }
    }
    if (method === 'GET' && url.includes('?after_seq=')) {
      const seeded = (routes[url] as { messages?: unknown[] } | undefined)?.messages ?? []
      return { ok: true, status: 200, json: async () => ({ messages: [...seeded, ...createdMessages] }) }
    }
    if (method === 'GET' && /\/sessions\/[^/]+\/tasks$/.test(url)) {
      const seeded = (routes[url] as { tasks?: unknown[] } | undefined)?.tasks ?? []
      // 种子 + patched 覆盖：PATCH 后的任务状态优先；无种子时并入 patched 任务。
      // 未发生 PATCH 时 patchedTasks 为空 → 原样返回种子（既有用例语义不变）
      const merged = [
        ...seeded.map((t) => patchedTasks.find((p) => (p as { id?: string }).id === (t as { id?: string }).id) ?? t),
        ...patchedTasks.filter(
          (p) => !(seeded as Array<Record<string, unknown>>).some((t) => (t as { id?: string }).id === (p as { id?: string }).id),
        ),
      ]
      return { ok: true, status: 200, json: async () => ({ tasks: merged }) }
    }
    const body = routes[url]
    if (body !== undefined) {
      return { ok: true, status: 200, json: async () => body }
    }
    throw new Error(`unmocked fetch: ${url}`)
  }))
}

class FakeSpeechRecognition {
  lang = ''
  interimResults = false
  continuous = false
  onresult: ((e: unknown) => void) | null = null
  onerror: (() => void) | null = null
  onend: (() => void) | null = null
  start() {}
  stop() {}
}

class FakeRecorder {
  static isTypeSupported = () => true
  state = 'inactive'
  stream = { getTracks: () => [{ stop: vi.fn() }] }
  ondataavailable: ((e: { data: { size: number } }) => void) | null = null
  onstop: (() => void) | null = null
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.onstop?.()
  }
}

describe('Chat', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeWebSocket.instances = []
    localStorage.clear()
    mockStop.mockClear()
    mockSpeechSession.start.mockClear()
  })

  it('renders sessions and messages, sends a message', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': { messages: [] },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [{ userId: 'u-alice', name: 'alice', kind: 'human' }] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    // 会话标题同时出现在侧边栏会话项与聊天头部，用 role 查询唯一定位侧边栏按钮
    await waitFor(() => expect(screen.getByRole('button', { name: '报销系统' })).toBeTruthy())
    await userEvent.type(screen.getByPlaceholderText(/发消息/), '你好')
    await userEvent.click(screen.getByRole('button', { name: /发送/ }))
    await waitFor(() => expect(screen.getByText('你好')).toBeTruthy())
  })

  it('renders an AI badge for agent messages', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': {
        messages: [{ id: 'm2', clientMsgId: 'a1', sessionId: 's1', senderId: 'agent-ta-fullstack', senderKind: 'agent', contentType: 'text', content: '收到需求', seq: 1, createdAt: '' }],
      },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [{ userId: 'u-alice', name: 'alice', kind: 'human' }] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText('AI')).toBeTruthy()
    expect(screen.getByText('收到需求')).toBeTruthy()
  })

  it('renders the display name for each agent role', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': {
        messages: [
          { id: 'm1', clientMsgId: 'c1', sessionId: 's1', senderId: 'agent-ta-pm', senderKind: 'agent', contentType: 'text', content: '需求已澄清', seq: 1, createdAt: '' },
          { id: 'm2', clientMsgId: 'c2', sessionId: 's1', senderId: 'agent-ta-qa', senderKind: 'agent', contentType: 'text', content: '测试通过', seq: 2, createdAt: '' },
        ],
      },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [{ userId: 'u-alice', name: 'alice', kind: 'human' }] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText('需求已澄清')).toBeTruthy()
    expect(screen.getByText('Ta-PM')).toBeTruthy()
    expect(screen.getByText('Ta-QA')).toBeTruthy()
  })

  it('renders a task card with status buttons', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': {
        messages: [{
          id: 'm1', clientMsgId: 'c1', sessionId: 's1', senderId: 'u-alice', senderKind: 'human',
          contentType: 'task_card', content: '📋 待开始：支付网关对接（负责人 @Ta-Fullstack）', seq: 1, createdAt: '',
          ref: { kind: 'task', id: 't1' },
        }],
      },
      '/api/v1/tasks/t1/status': { task: { id: 't1', sessionId: 's1', title: '支付网关对接', assigneeId: 'agent-ta-fullstack', assigneeKind: 'agent', status: 'in_progress' } },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [{ userId: 'u-alice', name: 'alice', kind: 'human' }] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText(/支付网关对接/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /进行中/ }))
    await waitFor(() => expect(screen.getByText(/进行中：支付网关对接/)).toBeTruthy())
  })

  it('lists memories in the sidebar', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': { messages: [] },
      '/api/v1/sessions/s1/memories': { memories: [{ id: 'mem1', sessionId: 's1', title: '需求基线', content: '基线内容', currentVersion: 1, createdBy: 'u-alice', createdAt: '', updatedAt: '' }] },
      '/api/v1/sessions/s1/members': { members: [{ userId: 'u-alice', name: 'alice', kind: 'human' }] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText('需求基线')).toBeTruthy()
    expect(screen.getByText('记忆')).toBeTruthy()
  })

  it('renders members and a reply preview', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': {
        messages: [
          { id: 'm1', clientMsgId: 'c1', sessionId: 's1', senderId: 'u-alice', senderKind: 'human', contentType: 'text', content: '原始消息', seq: 1, createdAt: '' },
          { id: 'm2', clientMsgId: 'c2', sessionId: 's1', senderId: 'u-bob', senderKind: 'human', contentType: 'text', content: '引用回复', seq: 2, createdAt: '', replyTo: 'm1', replyPreview: '原始消息' },
        ],
      },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': {
        members: [
          { userId: 'u-alice', name: 'alice', kind: 'human' },
          { userId: 'agent-ta-fullstack', name: 'Ta-Fullstack', kind: 'agent' },
        ],
      },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText('原始消息')).toBeTruthy()
    expect(screen.getByText(/引用回复/)).toBeTruthy()
  })

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

  it('renders a file message', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': {
        messages: [
          { id: 'm1', clientMsgId: 'c1', sessionId: 's1', senderId: 'u-alice', senderKind: 'human', contentType: 'file', content: '需求文档.txt', seq: 1, createdAt: '', ref: { kind: 'file', id: 'f1' } },
        ],
      },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [{ userId: 'u-alice', name: 'alice', kind: 'human' }] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText(/需求文档.txt/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /下载/ })).toBeTruthy()
  })

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
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [{ userId: 'u-alice', name: 'alice', kind: 'human' }] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
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
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [{ userId: 'u-alice', name: 'alice', kind: 'human' }] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText('✅ 已通过：上线审批')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /通过/ })).toBeNull()
  })

  it('sends a transcript text after speech stop', async () => {
    mockStop.mockResolvedValueOnce({ kind: 'transcript', text: '语音转写结果' })
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': { messages: [] },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
      // POST /messages 分支会按发送体自建 message 并推入 createdMessages，此 key 仅作占位（与 mockFetch 实现一致）
      '/api/v1/sessions/s1/messages': { message: { id: 'm9', clientMsgId: 'c9', sessionId: 's1', senderId: 'u-alice', senderKind: 'human', contentType: 'text', content: '语音转写结果', seq: 9, createdAt: '', ref: null } },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    const mic = await screen.findByRole('button', { name: /🎤/ })
    fireEvent.pointerDown(mic)
    fireEvent.pointerUp(mic)
    expect(await screen.findByText(/语音转写结果/)).toBeTruthy()
  })

  it('uploads audio blob when speech degrades', async () => {
    mockStop.mockResolvedValueOnce({ kind: 'audio', blob: new Blob(['x'], { type: 'audio/webm' }), mime: 'audio/webm' })
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': { messages: [] },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
      // files-POST 分支会取此 body 的 message 推入 createdMessages，供重拉列表渲染语音气泡
      '/api/v1/sessions/s1/files': { file: { id: 'f1', sessionId: 's1', name: '语音-1.webm', size: 1, mime: 'audio/webm', uploadedBy: 'u-alice', createdAt: '' }, message: { id: 'm10', clientMsgId: 'c10', sessionId: 's1', senderId: 'u-alice', senderKind: 'human', contentType: 'file', content: '语音-1.webm', seq: 10, createdAt: '', ref: { kind: 'file', id: 'f1' }, file: { id: 'f1', name: '语音-1.webm', size: 1, mime: 'audio/webm' } } },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    const mic = await screen.findByRole('button', { name: /🎤/ })
    fireEvent.pointerDown(mic)
    fireEvent.pointerUp(mic)
    // 语音气泡渲染「🎤 语音消息」（不显示文件名）→ 断言该文本与播放按钮
    expect(await screen.findByText(/🎤 语音消息/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /播放/ })).toBeTruthy()
  })

  it('hides the mic button when recording is unsupported', async () => {
    mockSpeechSession.canRecord = false
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': { messages: [] },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    // 会话标题同时出现在侧边栏与聊天头部，findByText 会命中多个元素 → 用 role 查询等待会话加载完成
    await screen.findByRole('button', { name: '报销系统' })
    expect(screen.queryByRole('button', { name: /🎤/ })).toBeNull()
    mockSpeechSession.canRecord = true
  })

  it('renders approval node progress and can transfer', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('u-carol')
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': {
        messages: [
          { id: 'm1', clientMsgId: 'c1', sessionId: 's1', senderId: 'u-alice', senderKind: 'human', contentType: 'confirmation_card', content: '待审批：两级审批', seq: 1, createdAt: '', ref: { kind: 'approval', id: 'a1' } },
        ],
      },
      '/api/v1/approvals/a1': { approval: { id: 'a1', sessionId: 's1', title: '两级审批', status: 'pending', approverId: 'u-bob', createdBy: 'u-alice', createdAt: '', mode: 'single', currentNodeIndex: 0, version: 1, nodes: [{ index: 0, mode: 'single', approverIds: ['u-bob'], status: 'pending' }] } },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [{ userId: 'u-bob', name: 'bob', kind: 'human' }] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText(/单人·u-bob·⏳/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /转办/ })).toBeTruthy()
  })

  it('advances multi-level nodes on decide without flickering content (M1 approvalById sync)', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': {
        messages: [
          { id: 'm1', clientMsgId: 'c1', sessionId: 's1', senderId: 'u-alice', senderKind: 'human', contentType: 'confirmation_card', content: '待审批：两级审批', seq: 1, createdAt: '', ref: { kind: 'approval', id: 'a1' } },
        ],
      },
      '/api/v1/approvals/a1': { approval: { id: 'a1', sessionId: 's1', title: '两级审批', status: 'pending', approverId: 'u-bob', createdBy: 'u-alice', createdAt: '', mode: 'single', currentNodeIndex: 0, version: 1, nodes: [
        { index: 0, mode: 'single', approverIds: ['u-bob'], status: 'pending' },
        { index: 1, mode: 'single', approverIds: ['u-carol'], status: 'pending' },
      ] } },
      '/api/v1/approvals/a1/decide': { approval: { id: 'a1', sessionId: 's1', title: '两级审批', status: 'pending', approverId: 'u-carol', createdBy: 'u-alice', createdAt: '', mode: 'single', currentNodeIndex: 1, version: 1, nodes: [
        { index: 0, mode: 'single', approverIds: ['u-bob'], status: 'approved' },
        { index: 1, mode: 'single', approverIds: ['u-carol'], status: 'pending' },
      ] } },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [{ userId: 'u-bob', name: 'bob', kind: 'human' }] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    // 初始：节点 0 待审批（⏳）
    expect(await screen.findByText(/单人·u-bob·⏳/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /通过/ }))
    // 中间节点通过：decide 返回 status=pending → 卡片前缀保持「待审批」（无闪变、非乐观「✅ 已通过」）
    await waitFor(() => expect(screen.getByText('待审批：两级审批')).toBeTruthy())
    expect(screen.queryByText(/✅ 已通过/)).toBeNull()
    // approvalById 已同步 → 节点 0 显示 ✅、active 推进到节点 1
    await waitFor(() => expect(screen.getByText(/单人·u-bob·✅/)).toBeTruthy())
    expect(screen.getByText(/单人·u-carol·⏳/).className).toContain('active')
  })

  it('shows resubmit and cancel actions for a returned approval', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': {
        messages: [
          { id: 'm1', clientMsgId: 'c1', sessionId: 's1', senderId: 'u-alice', senderKind: 'human', contentType: 'confirmation_card', content: '↩️ 已退回修改：上线审批', seq: 1, createdAt: '', ref: { kind: 'approval', id: 'a1' } },
        ],
      },
      '/api/v1/approvals/a1': { approval: { id: 'a1', sessionId: 's1', title: '上线审批', status: 'returned', approverId: 'u-bob', createdBy: 'u-alice', createdAt: '', reason: '缺少测试报告', mode: 'single', currentNodeIndex: 0, version: 1, nodes: [{ index: 0, mode: 'single', approverIds: ['u-bob'], status: 'pending' }] } },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [{ userId: 'u-alice', name: 'alice', kind: 'human' }] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText('↩️ 已退回修改：上线审批')).toBeTruthy()
    // approval 详情后台合并后，发起人端显示「重新提交」「撤销」
    await waitFor(() => expect(screen.getByRole('button', { name: /重新提交/ })).toBeTruthy())
    expect(screen.getByRole('button', { name: /撤销/ })).toBeTruthy()
  })

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
      // PATCH /api/v1/tasks/t1/status 由 mockFetch 的 PATCH 分支拦截（状态写入 patchedTasks，
      // 供 GET tasks 合并）；此静态路由仅在种子缺失时作返回体回退
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
    // 真实证明移动：列头「🔄 进行中」恒渲染，仅断言它无法证明任务移动（空转）。
    // 改为断言 ① PATCH 状态路由被调用（mockFetch 的 patchedTasks 使重拉返回新状态）
    // ② 任务卡出现在进行中列内（within 限定列作用域，等待重拉后卡片迁移）
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/v1/tasks/t1/status', expect.objectContaining({ method: 'PATCH' })),
    )
    const inProgressColumn = screen.getByText(/🔄 进行中/).closest('.kanban-column')! as HTMLElement
    expect(await within(inProgressColumn).findByText(/写登录页/)).toBeTruthy()
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
      // POST /messages 分支会按发送体自建 message 并推入 createdMessages，此 key 仅作占位（与 mockFetch 实现一致）
      '/api/v1/sessions/s1/messages': { message: { id: 'm9', clientMsgId: 'c9', sessionId: 's1', senderId: 'u-alice', senderKind: 'human', contentType: 'text', content: '【日报】', seq: 9, createdAt: '', ref: null } },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText(/写登录页/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /📅 日报/ }))
    expect(await screen.findByText(/【日报】/)).toBeTruthy()
  })

  it('shows skill chips and quota bar', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': { messages: [] },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
      '/api/v1/skills': { skills: [{ id: 'fullstack', name: '全栈开发', description: 'd', toolAllowlist: [] }] },
      '/api/v1/org/quota': { quota: { level: 'enterprise', budget: 1000000, used: 500000, ratio: 0.5, tripped: false } },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText(/全栈开发/)).toBeTruthy()
    expect(await screen.findByText(/配额 50%/)).toBeTruthy()
  })
})
