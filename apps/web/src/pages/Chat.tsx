import { useCallback, useEffect, useRef, useState } from 'react'
import type { Memory, Message, TaskStatus } from '@ta/contracts'
import { createMemory, createSession, decideApproval, listMemories, listMessages, listSessions, sendMessage, updateMemory, updateTaskStatus } from '../api/client.js'
import { WsClient } from '../api/ws.js'
import type { SessionWithUnread } from '../api/client.js'

export interface ChatProps {
  onLogout: () => void
}

const AGENT_HINT = '@Ta-Fullstack '

const AGENT_NAMES: Record<string, string> = {
  'agent-ta-pm': 'Ta-PM',
  'agent-ta-architect': 'Ta-Architect',
  'agent-ta-fullstack': 'Ta-Fullstack',
  'agent-ta-qa': 'Ta-QA',
}

export function Chat({ onLogout }: ChatProps) {
  const [sessions, setSessions] = useState<SessionWithUnread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [memories, setMemories] = useState<Memory[]>([])
  const [editing, setEditing] = useState<Memory | 'new' | null>(null)
  const [memTitle, setMemTitle] = useState('')
  const [memContent, setMemContent] = useState('')
  const wsRef = useRef<WsClient | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const creatingRef = useRef(false)
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

  const loadMemories = useCallback(async (sessionId: string) => {
    try {
      const res = await listMemories(sessionId)
      setMemories(res.memories)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载记忆失败')
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
        if (ev.type === 'message.updated' && ev.message) {
          if (ev.message.sessionId === activeIdRef.current) {
            setMessages((prev) => prev.map((m) => (m.id === ev.message!.id ? ev.message! : m)))
          }
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
    if (activeId) {
      void loadMessages(activeId)
      void loadMemories(activeId)
    }
  }, [activeId, loadMessages, loadMemories])

  async function ensureSession(): Promise<string | null> {
    if (activeId) return activeId
    const me = sessions[0]
    if (me) return me.id
    if (creatingRef.current) return null
    creatingRef.current = true
    try {
      const res = await createSession('project', '报销系统', [])
      setSessions((prev) => [...prev, { ...res.session, unreadCount: 0 }])
      setActiveId(res.session.id)
      return res.session.id
    } finally {
      creatingRef.current = false
    }
  }

  async function send() {
    const content = input.trim()
    if (!content || busy) return
    setBusy(true)
    setError(null)
    try {
      const sessionId = await ensureSession()
      if (!sessionId) return
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

  async function decide(message: Message, decision: 'approved' | 'rejected') {
    if (!message.ref || message.ref.kind !== 'approval') return
    setError(null)
    try {
      await decideApproval(message.ref.id, { decision })
      // message.updated 事件会原位更新卡片；这里乐观置为已决，防 WS 延迟
      const title = message.content.replace('待审批：', '')
      setMessages((prev) =>
        prev.map((m) =>
          m.id === message.id
            ? { ...m, content: decision === 'approved' ? `✅ 已通过：${title}` : `❌ 已驳回：${title}` }
            : m,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '决策失败')
    }
  }

  async function moveTask(message: Message, status: TaskStatus) {
    if (!message.ref || message.ref.kind !== 'task') return
    setError(null)
    try {
      const { task } = await updateTaskStatus(message.ref.id, status)
      // 用服务端返回的 task 重新构造卡片内容（避免解析 content 前缀）
      const label = { todo: '📋 待开始', in_progress: '🔄 进行中', blocked: '⛔ 已阻塞', done: '✅ 已完成' }[status]
      const assignee = task.assigneeKind === 'agent' ? `@${AGENT_NAMES[task.assigneeId] ?? task.assigneeId}` : task.assigneeId
      const content = `${label}：${task.title}（负责人 ${assignee}）`
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, content } : m)))
    } catch (err) {
      setError(err instanceof Error ? err.message : '任务更新失败')
    }
  }

  function mentionAgent() {
    setInput((prev) => (prev.startsWith(AGENT_HINT) ? prev : AGENT_HINT + prev))
  }

  function openNewMemory() {
    setEditing('new')
    setMemTitle('')
    setMemContent('')
  }

  function openEditMemory(mem: Memory) {
    setEditing(mem)
    setMemTitle(mem.title)
    setMemContent(mem.content)
  }

  async function saveMemory() {
    if (!activeId) return
    try {
      if (editing === 'new') {
        await createMemory(activeId, { title: memTitle.trim(), content: memContent.trim() })
      } else if (editing) {
        await updateMemory(editing.id, { content: memContent.trim(), title: memTitle.trim() || undefined })
      }
      setEditing(null)
      const res = await listMemories(activeId)
      setMemories(res.memories)
    } catch (err) {
      setError(err instanceof Error ? err.message : '记忆保存失败')
    }
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
        <div className="memory-block">
          <div className="memory-head">
            <strong>记忆</strong>
            <button className="ghost" onClick={openNewMemory}>＋</button>
          </div>
          {memories.map((mem) => (
            <div key={mem.id} className="memory-item">
              <button className="memory-title" onClick={() => openEditMemory(mem)}>{mem.title}</button>
            </div>
          ))}
        </div>
      </aside>

      <main className="chat-main">
        <header className="chat-head">
          <strong>{sessions.find((s) => s.id === activeId)?.title ?? '未选择会话'}</strong>
          <button className="ghost" onClick={mentionAgent}>@ 智能体</button>
        </header>
        <div className="message-list">
          {messages.map((m) => {
            const isCard = m.contentType === 'confirmation_card'
            const isTask = m.contentType === 'task_card'
            const isPending = isCard && m.content.startsWith('待审批')
            return (
              <div key={m.id} className={m.senderKind === 'agent' ? 'bubble-row agent' : 'bubble-row human'}>
                <div className="bubble-meta">
                  {m.senderKind === 'agent' ? <span className="ai-badge">AI</span> : null}
                  <span className="bubble-name">
                    {m.senderKind === 'agent' ? (AGENT_NAMES[m.senderId] ?? 'AI 智能体') : m.senderId}
                  </span>
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
                ) : isTask ? (
                  <div className="task-card">
                    <strong>{m.content}</strong>
                    {m.ref?.kind === 'task' ? (
                      <div className="task-actions">
                        {(['todo', 'in_progress', 'blocked', 'done'] as TaskStatus[]).map((s) => (
                          <button
                            key={s}
                            className={s === 'done' ? 'approve' : s === 'blocked' ? 'reject' : undefined}
                            onClick={() => void moveTask(m, s)}
                          >
                            {s === 'todo' ? '待开始' : s === 'in_progress' ? '进行中' : s === 'blocked' ? '阻塞' : '完成'}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="bubble">{m.content}</div>
                )}
              </div>
            )
          })}
        </div>
        {error && <p className="chat-error">{error}</p>}
        <footer className="input-area">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send()
            }}
            placeholder="发消息… 或 @Ta-PM / @Ta-Fullstack / @Ta-QA 提需求"
          />
          <button onClick={() => void send()} disabled={busy || !input.trim()}>
            发送
          </button>
        </footer>
      </main>

      {editing !== null && (
        <div className="memory-modal">
          <div className="memory-modal-box">
            <h3>{editing === 'new' ? '新建记忆' : '编辑记忆'}</h3>
            <input value={memTitle} onChange={(e) => setMemTitle(e.target.value)} placeholder="标题" />
            <textarea value={memContent} onChange={(e) => setMemContent(e.target.value)} rows={6} placeholder="内容" />
            <div className="memory-modal-actions">
              <button className="ghost" onClick={() => setEditing(null)}>取消</button>
              <button onClick={() => void saveMemory()}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
