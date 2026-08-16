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
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText('AI')).toBeTruthy()
    expect(screen.getByText('收到需求')).toBeTruthy()
  })
})
