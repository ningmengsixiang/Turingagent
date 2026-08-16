# Phase 0 · 计划 4：前端竖切（登录 + 聊天窗）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Phase 0 验收的最后一环：浏览器里打开 Web 应用 → 登录 → 建会话 → 发 `@Ta-Fullstack <需求>` → 智能体回复实时出现在聊天窗。前端 = `apps/web`（Vite + React 19 + TS），消费既有网关 API 与 WS，共享 `@ta/contracts` 类型。

**Architecture:** `apps/web` 三部分：`api/`（fetch 封装 + WS 客户端）→ `pages/`（Login / Chat 两个页面，token 门控）→ 组件（消息气泡：agent 消息带 AI 徽标，PR-2 身份透明）。开发期 Vite proxy 把 `/api`、`/ws` 转发到网关 `:3001`（无 CORS 改动）。根脚本 `pnpm dev` 并行起网关 + Web。

**Tech Stack:** Vite 6 + React 19 + TypeScript（strict, bundler resolution, jsx react-jsx）+ vitest 3 + jsdom；原生 fetch/WebSocket/crypto.randomUUID。

**决策记录：** D2 = Web 优先已拍板；UI 走简洁功能风（Apple 设计体系留给产品化，本计划只保证干净可用）；未读数/会话列表只做列表展示，不做完整工作台（M0.6 竖切范围）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `apps/web/package.json` | 创建 | @ta/web |
| `apps/web/tsconfig.json` | 创建 | 前端 TS 配置 |
| `apps/web/vite.config.ts` | 创建 | Vite + proxy（/api、/ws → :3001） |
| `apps/web/vitest.config.ts` | 创建 | jsdom 测试环境 |
| `apps/web/index.html` | 创建 | 入口 HTML |
| `apps/web/src/main.tsx` | 创建 | React 挂载 |
| `apps/web/src/App.tsx` | 创建 | token 门控（无 token → Login，有 → Chat） |
| `apps/web/src/api/client.ts` | 创建 | fetch 封装（Bearer、401 清 token、错误体） |
| `apps/web/src/api/ws.ts` | 创建 | WebSocketClient（token query、指数退避重连、事件解析） |
| `apps/web/src/pages/Login.tsx` | 创建 | 登录表单 |
| `apps/web/src/pages/Chat.tsx` | 创建 | 会话列表 + 消息流 + 输入框（@ 提示） |
| `apps/web/src/app.css` | 创建 | 简洁样式（气泡/AI 徽标/输入区） |
| `package.json`（根） | 修改 | 增 `dev`（并行起 gateway + web） |
| 测试 | 创建 | client.test.ts、ws.test.ts、Login.test.tsx、Chat.test.tsx |

---

## Task 1: apps/web 脚手架

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Modify: `package.json`（根，增 dev 脚本）

- [ ] **Step 1: 写 apps/web/package.json**

```json
{
  "name": "@ta/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit -p tsconfig.json && vite build",
    "preview": "vite preview",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@ta/contracts": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.3",
    "vite": "^6.0.7",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: 写 apps/web/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 3: 写 apps/web/vite.config.ts**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
})
```

- [ ] **Step 4: 写 apps/web/vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

- [ ] **Step 5: 写 apps/web/index.html**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Turing Agent</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: 写 apps/web/src/main.tsx**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 7: 修改根 package.json 增 dev 脚本**

在根 `package.json` 的 scripts 里 `"dev:gateway"` 之后加：

```json
    "dev": "pnpm --parallel -r --filter ./apps/web --filter ./services/gateway dev",
```

> 注：`pnpm -r --parallel` 需要每个包都有 dev 脚本（web 有 `vite`、gateway 有 `tsx watch`）。若 `--filter ./apps/web` 语法在 pnpm 11 下不生效，改用 `"dev": "pnpm --parallel -r dev --filter '@ta/web' --filter '@ta/gateway'"` 或直接两个后台命令——以 pnpm 11 实际行为为准，保证一条命令同时拉起两个 dev server。

- [ ] **Step 8: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm install
pnpm --filter @ta/contracts build
pnpm --filter @ta/web typecheck
```

Expected: install 成功；contracts build 成功（web 依赖其类型）；web typecheck exit 0（此时 src 只有 main.tsx 引用 App.tsx——**Task 1 需先放最小 App.tsx 占位**：`export function App() { return <div>loading</div> }`，Task 2/3 替换）。

- [ ] **Step 9: 提交**

```bash
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat(web): Vite + React 脚手架（proxy/vitest/根 dev 脚本）"
```

---

## Task 2: API 客户端 + 登录页

**Files:**
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/api/client.test.ts`
- Create: `apps/web/src/pages/Login.tsx`
- Create: `apps/web/src/pages/Login.test.tsx`
- Modify: `apps/web/src/App.tsx`（token 门控，Task 1 占位替换）

- [ ] **Step 1: 写 src/api/client.ts**

```ts
import type { Message, Session } from '@ta/contracts'

const TOKEN_KEY = 'ta.token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

interface ApiErrorBody {
  error?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (res.status === 401) {
    clearToken()
    throw new Error('unauthorized')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody
    throw new Error(body.error ?? `http ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export interface LoginResponse {
  token: string
  user: { id: string; name: string }
}

export interface SessionWithUnread extends Session {
  unreadCount: number
}

export const login = (username: string): Promise<LoginResponse> =>
  request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username }) })

export const listSessions = (): Promise<{ sessions: SessionWithUnread[] }> => request('/api/v1/sessions')

export const createSession = (
  kind: 'direct' | 'project' | 'group',
  title: string,
  memberIds: string[],
): Promise<{ session: Session }> =>
  request('/api/v1/sessions', { method: 'POST', body: JSON.stringify({ kind, title, memberIds }) })

export const listMessages = (sessionId: string, afterSeq = 0): Promise<{ messages: Message[] }> =>
  request(`/api/v1/sessions/${sessionId}/messages?after_seq=${afterSeq}`)

export const sendMessage = (
  sessionId: string,
  input: { clientMsgId: string; contentType: string; content: string },
): Promise<{ message: Message }> =>
  request(`/api/v1/sessions/${sessionId}/messages`, { method: 'POST', body: JSON.stringify(input) })
```

- [ ] **Step 2: 写 src/api/client.test.ts**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearToken, getToken, listSessions, login, setToken, sendMessage } from './client.js'

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    clearToken()
  })

  it('logs in and stores the token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'jwt-1', user: { id: 'u-alice', name: 'alice' } }),
    }))
    const res = await login('alice')
    expect(res.token).toBe('jwt-1')
    expect(getToken()).toBe('jwt-1')
    expect(fetch).toHaveBeenCalledWith('/api/v1/auth/login', expect.objectContaining({ method: 'POST' }))
  })

  it('sends the bearer token on authenticated calls', async () => {
    setToken('jwt-2')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ sessions: [] }) }))
    await listSessions()
    expect(fetch).toHaveBeenCalledWith('/api/v1/sessions', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer jwt-2' }),
    }))
  })

  it('clears the token on 401', async () => {
    setToken('jwt-3')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    await expect(listSessions()).rejects.toThrow(/unauthorized/)
    expect(getToken()).toBeNull()
  })

  it('throws the api error message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'username is required' }) }))
    await expect(sendMessage('s1', { clientMsgId: 'x', contentType: 'text', content: 'hi' })).rejects.toThrow('username is required')
  })
})
```

- [ ] **Step 3: 写 src/pages/Login.tsx**

```tsx
import { useState } from 'react'
import { login, setToken } from '../api/client.js'

export interface LoginProps {
  onAuthed: (name: string) => void
}

export function Login({ onAuthed }: LoginProps) {
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!username.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await login(username.trim())
      setToken(res.token)
      onAuthed(res.user.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>Turing Agent</h1>
        <p className="login-sub">与智能体团队协作的软件交付工作台</p>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="用户名（演示登录，任意名字）"
          autoFocus
        />
        {error && <p className="login-error">{error}</p>}
        <button type="submit" disabled={busy || !username.trim()}>
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: 写 src/pages/Login.test.tsx**

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Login } from './Login.js'

describe('Login', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('renders and logs in on submit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'jwt', user: { id: 'u-alice', name: 'alice' } }),
    }))
    const onAuthed = vi.fn()
    render(<Login onAuthed={onAuthed} />)
    await userEvent.type(screen.getByPlaceholderText(/用户名/), 'alice')
    await userEvent.click(screen.getByRole('button', { name: /登录/ }))
    expect(onAuthed).toHaveBeenCalledWith('alice')
    expect(localStorage.getItem('ta.token')).toBe('jwt')
  })

  it('shows an error on failed login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    }))
    render(<Login onAuthed={vi.fn()} />)
    await userEvent.type(screen.getByPlaceholderText(/用户名/), 'alice')
    await userEvent.click(screen.getByRole('button', { name: /登录/ }))
    expect(await screen.findByText('unauthorized')).toBeTruthy()
  })
})
```

> 注：需要 `@testing-library/react` 与 `@testing-library/user-event` 为 devDeps（Task 1 Step 1 的 package.json 未含——**Task 2 Step 1 前补加**：`"@testing-library/react": "^16.1.0"`、`"@testing-library/user-event": "^14.5.2"`）。

- [ ] **Step 5: 写 src/App.tsx（替换 Task 1 占位）**

```tsx
import { useEffect, useState } from 'react'
import { getToken } from './api/client.js'
import { Login } from './pages/Login.js'
import { Chat } from './pages/Chat.js'

export function App() {
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null)

  useEffect(() => {
    if (!getToken()) setAuthed(false)
  }, [])

  if (!authed) {
    return <Login onAuthed={() => setAuthed(true)} />
  }
  return <Chat onLogout={() => { localStorage.removeItem('ta.token'); setAuthed(false) }} />
}
```

> 注：App 引用 `./pages/Chat.js`——Task 2 需放**最小 Chat 占位**（`export function Chat({ onLogout }: { onLogout: () => void }) { return <div>chat</div> }`），Task 3 替换。

- [ ] **Step 6: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm install
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose
```

Expected: typecheck exit 0；client.test 4 + Login.test 2 用例全 PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web
git commit -m "feat(web): API 客户端 + 登录页（token 门控）"
```

---

## Task 3: WS 客户端 + 聊天窗

**Files:**
- Create: `apps/web/src/api/ws.ts`
- Create: `apps/web/src/api/ws.test.ts`
- Create: `apps/web/src/pages/Chat.tsx`
- Create: `apps/web/src/pages/Chat.test.tsx`
- Create: `apps/web/src/app.css`
- Modify: `apps/web/src/pages/Login.test.tsx`（如需）、`apps/web/src/pages/Chat.tsx` 引用的样式

- [ ] **Step 1: 写 src/api/ws.ts**

```ts
export type WsEventHandler = (event: unknown) => void

export class WsClient {
  private socket: WebSocket | null = null
  private retry = 0
  private closed = false

  constructor(
    private readonly url: string,
    private readonly onEvent: WsEventHandler,
  ) {}

  connect(): void {
    this.closed = false
    this.open()
  }

  close(): void {
    this.closed = true
    this.socket?.close()
    this.socket = null
  }

  private open(): void {
    if (this.closed) return
    const token = localStorage.getItem('ta.token') ?? ''
    const socket = new WebSocket(`${this.url}?token=${encodeURIComponent(token)}`)
    this.socket = socket
    socket.onopen = () => {
      this.retry = 0
    }
    socket.onmessage = (e) => {
      try {
        this.onEvent(JSON.parse(String(e.data)))
      } catch {
        // 忽略无法解析的帧
      }
    }
    socket.onclose = () => {
      if (this.closed) return
      const delay = Math.min(1000 * 2 ** this.retry, 10_000)
      this.retry += 1
      setTimeout(() => this.open(), delay)
    }
    socket.onerror = () => socket.close()
  }
}
```

- [ ] **Step 2: 写 src/api/ws.test.ts**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

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

import { WsClient } from './ws.js'

describe('WsClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeWebSocket.instances = []
    localStorage.clear()
  })

  it('connects with the token and forwards parsed events', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    localStorage.setItem('ta.token', 'jwt-ws')
    const onEvent = vi.fn()
    const client = new WsClient('ws://localhost:3001/ws', onEvent)
    client.connect()
    expect(FakeWebSocket.instances[0]!.url).toBe('ws://localhost:3001/ws?token=jwt-ws')
    FakeWebSocket.instances[0]!.onmessage?.({ data: '{"type":"welcome","user":{"id":"u-a"}}' })
    expect(onEvent).toHaveBeenCalledWith({ type: 'welcome', user: { id: 'u-a' } })
    client.close()
  })

  it('reconnects with backoff after close', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.useFakeTimers()
    const client = new WsClient('ws://x', () => {})
    client.connect()
    FakeWebSocket.instances[0]!.onclose?.()
    expect(FakeWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1100)
    expect(FakeWebSocket.instances).toHaveLength(2)
    client.close()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 3: 写 src/pages/Chat.tsx**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Message } from '@ta/contracts'
import { createSession, listMessages, listSessions, sendMessage } from '../api/client.js'
import { WsClient } from '../api/ws.js'
import type { SessionWithUnread } from '../api/client.js'

export interface ChatProps {
  onLogout: () => void
}

const AGENT_HINT = '@Ta-Fullstack '

export function Chat({ onLogout }: ChatProps) {
  const [sessions, setSessions] = useState<SessionWithUnread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WsClient | null>(null)
  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId

  const refreshSessions = useCallback(async () => {
    try {
      const res = await listSessions()
      setSessions(res.sessions)
      if (!activeIdRef.current && res.sessions.length > 0) {
        setActiveId(res.sessions[0]!.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载会话失败')
    }
  }, [])

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await listMessages(sessionId)
      setMessages(res.messages)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载消息失败')
    }
  }, [])

  useEffect(() => {
    void refreshSessions()
    const ws = new WsClient(
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
      (event) => {
        const ev = event as { type: string; message?: Message }
        if (ev.type === 'message.new' && ev.message) {
          if (ev.message.sessionId === activeIdRef.current) {
            setMessages((prev) => (prev.some((m) => m.id === ev.message!.id) ? prev : [...prev, ev.message!]))
          }
          void refreshSessions()
        }
      },
    )
    ws.connect()
    wsRef.current = ws
    return () => {
      ws.close()
    }
  }, [refreshSessions])

  useEffect(() => {
    if (activeId) void loadMessages(activeId)
  }, [activeId, loadMessages])

  async function ensureSession(): Promise<string> {
    if (activeId) return activeId
    const me = sessions[0]
    if (me) return me.id
    const res = await createSession('project', '报销系统', [])
    setSessions((prev) => [...prev, { ...res.session, unreadCount: 0 }])
    setActiveId(res.session.id)
    return res.session.id
  }

  async function send() {
    const content = input.trim()
    if (!content || busy) return
    const sessionId = await ensureSession()
    setBusy(true)
    setError(null)
    try {
      const clientMsgId = crypto.randomUUID()
      await sendMessage(sessionId, { clientMsgId, contentType: 'text', content })
      setInput('')
      await loadMessages(sessionId)
      void refreshSessions()
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败')
    } finally {
      setBusy(false)
    }
  }

  function mentionAgent() {
    setInput((prev) => (prev.startsWith(AGENT_HINT) ? prev : AGENT_HINT + prev))
  }

  return (
    <div className="chat-layout">
      <aside className="session-sidebar">
        <div className="sidebar-head">
          <strong>Turing Agent</strong>
          <button className="ghost" onClick={onLogout}>退出</button>
        </div>
        <button className="new-session" onClick={() => void ensureSession()}>＋ 新建项目群</button>
        <ul>
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                className={s.id === activeId ? 'session-item active' : 'session-item'}
                onClick={() => setActiveId(s.id)}
              >
                <span>{s.title}</span>
                {s.unreadCount > 0 && <span className="unread">{s.unreadCount}</span>}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="chat-main">
        <header className="chat-head">
          <strong>{sessions.find((s) => s.id === activeId)?.title ?? '未选择会话'}</strong>
          <button className="ghost" onClick={mentionAgent}>@ 智能体</button>
        </header>
        <div className="message-list">
          {messages.map((m) => (
            <div key={m.id} className={m.senderKind === 'agent' ? 'bubble-row agent' : 'bubble-row human'}>
              <div className="bubble-meta">
                {m.senderKind === 'agent' ? (
                  <span className="ai-badge">AI</span>
                ) : null}
                <span className="bubble-name">{m.senderKind === 'agent' ? 'Ta-Fullstack' : m.senderId}</span>
              </div>
              <div className="bubble">{m.content}</div>
            </div>
          ))}
        </div>
        {error && <p className="chat-error">{error}</p>}
        <footer className="input-area">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send()
            }}
            placeholder="发消息… 或 @Ta-Fullstack 提需求"
          />
          <button onClick={() => void send()} disabled={busy || !input.trim()}>
            发送
          </button>
        </footer>
      </main>
    </div>
  )
}
```

- [ ] **Step 4: 写 src/pages/Chat.test.tsx**

```tsx
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
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  close(): void {
    this.closed = true
    this.onclose?.()
  }
  closed = false
}

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) {
        return { ok: true, status: 200, json: async () => body }
      }
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
      '/api/v1/sessions/s1/messages': { message: { id: 'm1', clientMsgId: 'x', sessionId: 's1', senderId: 'u-alice', senderKind: 'human', contentType: 'text', content: '你好', seq: 1, createdAt: '' } },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('报销系统')).toBeTruthy())
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
```

> 注：需要 `@testing-library/react`/`user-event` devDeps（Task 2 已加）；`Chat.test.tsx` 中 `FakeWebSocket` 类型需补 `closed` 字段声明顺序无碍。

- [ ] **Step 5: 写 src/app.css（简洁样式）**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif; color: #1d1d1f; background: #f5f5f7; }

.login-page { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
.login-card { display: flex; flex-direction: column; gap: 12px; width: 320px; padding: 32px; background: #fff; border-radius: 16px; box-shadow: 0 8px 30px rgba(0,0,0,.08); }
.login-card h1 { margin: 0; font-size: 24px; }
.login-sub { margin: 0; color: #6e6e73; font-size: 13px; }
.login-card input { padding: 10px 12px; border: 1px solid #d2d2d7; border-radius: 10px; font-size: 14px; }
.login-card button { padding: 10px; border: none; border-radius: 10px; background: #0071e3; color: #fff; font-size: 14px; cursor: pointer; }
.login-card button:disabled { opacity: .5; cursor: default; }
.login-error { color: #ff3b30; font-size: 13px; margin: 0; }

.chat-layout { display: flex; height: 100vh; }
.session-sidebar { width: 240px; background: #fff; border-right: 1px solid #e5e5ea; display: flex; flex-direction: column; padding: 12px; gap: 8px; }
.sidebar-head { display: flex; justify-content: space-between; align-items: center; }
.sidebar-head strong { font-size: 15px; }
.ghost { border: none; background: none; color: #0071e3; cursor: pointer; font-size: 13px; }
.new-session { padding: 8px; border: 1px dashed #d2d2d7; border-radius: 10px; background: none; cursor: pointer; color: #1d1d1f; }
.session-sidebar ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.session-item { display: flex; justify-content: space-between; width: 100%; padding: 10px; border: none; border-radius: 10px; background: none; cursor: pointer; text-align: left; }
.session-item.active { background: #f0f0f5; }
.unread { background: #ff3b30; color: #fff; border-radius: 10px; font-size: 11px; padding: 1px 6px; }

.chat-main { flex: 1; display: flex; flex-direction: column; background: #fff; }
.chat-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid #e5e5ea; }
.message-list { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.bubble-row { display: flex; flex-direction: column; max-width: 70%; }
.bubble-row.human { align-self: flex-end; align-items: flex-end; }
.bubble-row.agent { align-self: flex-start; align-items: flex-start; }
.bubble-meta { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 12px; color: #6e6e73; }
.ai-badge { background: #272729; color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 4px; }
.bubble { padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.bubble-row.human .bubble { background: #0071e3; color: #fff; border-bottom-right-radius: 4px; }
.bubble-row.agent .bubble { background: #f5f5f7; border-bottom-left-radius: 4px; }
.chat-error { color: #ff3b30; font-size: 13px; padding: 0 20px; margin: 0; }
.input-area { display: flex; gap: 8px; padding: 12px 20px; border-top: 1px solid #e5e5ea; }
.input-area input { flex: 1; padding: 10px 12px; border: 1px solid #d2d2d7; border-radius: 20px; font-size: 14px; }
.input-area button { padding: 10px 20px; border: none; border-radius: 20px; background: #0071e3; color: #fff; cursor: pointer; }
.input-area button:disabled { opacity: .5; cursor: default; }
```

- [ ] **Step 6: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm install
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose
pnpm --filter @ta/web build
```

Expected: typecheck exit 0；client 4 + Login 2 + ws 2 + Chat 2 = 10 用例全 PASS；vite build 产出 dist/。

- [ ] **Step 7: 提交**

```bash
git add apps/web
git commit -m "feat(web): WS 客户端 + 聊天窗（会话/消息/AI 徽标）"
```

---

## Task 4: 收尾（根 dev + README + 全仓验收 + 推送）

**Files:**
- Modify: `README.md`（根）

- [ ] **Step 1: README 补「Web 前端」节**

在「### 智能体（Ta-Fullstack）」之后追加：

```markdown
### Web 前端

```bash
pnpm dev          # 并行起网关（:3001）+ Web（:5173）
# 浏览器打开 http://localhost:5173
# 登录（任意用户名）→ 新建项目群 → 发 @Ta-Fullstack <需求> → 智能体回复实时到达
```
```

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm build
pnpm test
pnpm install --frozen-lockfile
```

Expected: build 全过（contracts + gateway + web）；test 全绿（contracts 2 + gateway 60 + web 10 = 72）；frozen-lockfile 通过；`git status` 干净（除 README）。

- [ ] **Step 3: 提交 + 推送**

```bash
git add README.md
git commit -m "docs: README 补 Web 前端运行说明"
git push
```

Expected: 推送成功。

---

## Self-Review 记录（写完后自查）

- **Spec 覆盖**：路线图 M0.6（前端竖切：登录 + 单会话聊天窗）→ Task 2/3；Phase 0 验收（浏览器 → 登录 → @Ta-Fullstack 回复）→ 全计划；PR-2 身份透明 → Chat AI 徽标 + agent 气泡样式。
- **占位符扫描**：Task 1 的 App.tsx 占位、Task 2 的 Chat.tsx 占位均为有意的执行顺序占位，计划已注明替换时机。
- **类型一致性**：`Message`/`Session` 来自 @ta/contracts（lib 构建产物）；`WsClient(url, onEvent)` 在 ws.ts/测试一致；`sendMessage`/`listMessages` 签名与网关 API 一致。
- **环境事实**：Vite proxy 避免 CORS 改动；`pnpm dev` 并行脚本以 pnpm 11 实际行为为准（注已写明）；测试用 jsdom + @testing-library。
- **已知取舍**：未做完整工作台（三栏/看板/组织——Phase 1）；未读数仅数字角标；WS 断线重连指数退避（10s 封顶）；UI 简洁功能风（Apple 设计体系产品化时套用）。
