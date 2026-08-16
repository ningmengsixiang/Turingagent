import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Chat } from './Chat.js'

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
    if (method === 'GET' && url.includes('?after_seq=')) {
      const seeded = (routes[url] as { messages?: unknown[] } | undefined)?.messages ?? []
      return { ok: true, status: 200, json: async () => ({ messages: [...seeded, ...createdMessages] }) }
    }
    const body = routes[url]
    if (body !== undefined) {
      return { ok: true, status: 200, json: async () => body }
    }
    throw new Error(`unmocked fetch: ${url}`)
  }))
}

describe('Chat', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeWebSocket.instances = []
    localStorage.clear()
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
})
