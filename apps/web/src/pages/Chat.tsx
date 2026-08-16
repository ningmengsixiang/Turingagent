import { useCallback, useEffect, useRef, useState } from 'react'
import type { Memory, Message, SessionMember, Task, TaskStatus } from '@ta/contracts'
import { createMemory, createSession, decideApproval, getFileDownloadUrl, listMemories, listMessages, listSessions, listSessionMembers, listTasks, sendMessage, summarizeMemory, updateMemory, updateTaskStatus, uploadFile } from '../api/client.js'
import { WsClient } from '../api/ws.js'
import type { SessionWithUnread } from '../api/client.js'
import { createSpeechSession, type SpeechSession } from '../lib/speech.js'

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
  const [members, setMembers] = useState<SessionMember[]>([])
  const [showMembers, setShowMembers] = useState(false)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [showMention, setShowMention] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [speech, setSpeech] = useState<SpeechSession | null>(null)
  const [recording, setRecording] = useState(false)
  const speechRef = useRef<SpeechSession | null>(null)
  const recordingRef = useRef(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [panelOpen, setPanelOpen] = useState(true)
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

  const loadMembers = useCallback(async (sessionId: string) => {
    try {
      const res = await listSessionMembers(sessionId)
      setMembers(res.members)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载成员失败')
    }
  }, [])

  const loadTasks = useCallback(async (sessionId: string) => {
    try {
      const res = await listTasks(sessionId)
      setTasks(res.tasks)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载任务失败')
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
            if (ev.message.contentType === 'task_card') void loadTasks(ev.message.sessionId)
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
    const s = createSpeechSession()
    speechRef.current = s
    setSpeech(s)
    return () => {
      // S5：卸载时释放麦克风
      speechRef.current?.stop().catch(() => {})
      speechRef.current = null
    }
  }, [])

  useEffect(() => {
    if (activeId) {
      void loadMessages(activeId)
      void loadMemories(activeId)
      void loadMembers(activeId)
      void loadTasks(activeId)
    }
  }, [activeId, loadMessages, loadMemories, loadMembers, loadTasks])

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
      await sendMessage(sessionId, { clientMsgId, contentType: 'text', content, replyTo: replyingTo?.id })
      setInput('')
      setReplyingTo(null)
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

  async function moveTaskFromBoard(taskId: string, status: TaskStatus) {
    setError(null)
    try {
      await updateTaskStatus(taskId, status)
      if (activeId) {
        await loadTasks(activeId)
        await loadMessages(activeId)
      }
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

  async function upload(files: FileList | null) {
    if (!activeId || !files || files.length === 0) return
    const file = files[0]!
    setError(null)
    try {
      await uploadFile(activeId, file)
      await loadMessages(activeId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    }
  }

  async function downloadFile(fileId: string, name: string) {
    try {
      const { url } = await getFileDownloadUrl(fileId)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载失败')
    }
  }

  async function handleSpeechStop() {
    recordingRef.current = false
    setRecording(false)
    const s = speechRef.current
    if (!s) return
    // 无条件 stop() 释放麦克风（M3：无会话时松手也必须停录音）
    let result
    try {
      result = await s.stop()
    } catch (err) {
      setError(err instanceof Error ? err.message : '语音发送失败')
      return
    }
    try {
      if (result.kind === 'transcript' && result.text) {
        // 转写成功 → 文字消息（直接走发送链路，避免 setInput 异步读旧值）
        setBusy(true)
        setError(null)
        try {
          const sessionId = await ensureSession()
          if (sessionId) {
            const clientMsgId = crypto.randomUUID()
            await sendMessage(sessionId, { clientMsgId, contentType: 'text', content: result.text, replyTo: replyingTo?.id })
            await loadMessages(sessionId)
            void refreshSessions()
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : '发送失败')
        } finally {
          setBusy(false)
        }
      } else if (result.kind === 'audio' && result.blob.size > 0) {
        // 降级：语音文件上传（决策 D6）；无会话时也建会话（与 send() 一致）
        const file = new File([result.blob], `语音-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`, {
          type: result.mime,
        })
        const sessionId = await ensureSession()
        if (!sessionId) return
        await uploadFile(sessionId, file)
        await loadMessages(sessionId)
        void refreshSessions()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '语音发送失败')
    }
  }

  return (
    <div className="chat-layout mention-host">
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
                onClick={() => { setActiveId(s.id); setReplyingTo(null); setShowMembers(false); setShowMention(false) }}
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
            <button className="ghost" onClick={() => void summarize()} disabled={summarizing}>
              {summarizing ? '沉淀中…' : '沉淀'}
            </button>
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
          <button className="ghost" onClick={() => setShowMembers(true)}>{members.length} 成员</button>
          <button className="ghost" onClick={mentionAgent}>@ 智能体</button>
        </header>
        <div className="message-list">
          {messages.map((m) => {
            const isCard = m.contentType === 'confirmation_card'
            const isTask = m.contentType === 'task_card'
            const isFile = m.contentType === 'file'
            const isVoice = m.contentType === 'voice' || (isFile && /audio\//.test(m.file?.mime ?? ''))
            const isPending = isCard && m.content.startsWith('待审批')
            return (
              <div key={m.id} className={m.senderKind === 'agent' ? 'bubble-row agent' : 'bubble-row human'}>
                <div className="bubble-meta">
                  {m.senderKind === 'agent' ? <span className="ai-badge">AI</span> : null}
                  <span className="bubble-name">
                    {m.senderKind === 'agent' ? (AGENT_NAMES[m.senderId] ?? 'AI 智能体') : m.senderId}
                  </span>
                  {m.senderKind === 'human' ? (
                    <button className="ghost small" onClick={() => setReplyingTo(m)}>引用</button>
                  ) : null}
                </div>
                {m.replyPreview ? <div className="reply-preview">↪ {m.replyPreview}</div> : null}
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
                ) : isVoice ? (
                  <div className="file-bubble voice-bubble">
                    <span>🎤 语音消息</span>
                    {m.ref?.kind === 'file' ? (
                      <button className="ghost small" onClick={() => void downloadFile(m.ref!.id, m.content)}>播放</button>
                    ) : null}
                  </div>
                ) : isFile ? (
                  <div className="file-bubble">
                    <span>📎 {m.content}</span>
                    {m.ref?.kind === 'file' ? (
                      <button className="ghost small" onClick={() => void downloadFile(m.ref!.id, m.content)}>下载</button>
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
        {replyingTo && (
          <div className="replying-bar">
            <span>↪ 回复：{replyingTo.content.slice(0, 60)}</span>
            <button className="ghost" onClick={() => setReplyingTo(null)}>取消</button>
          </div>
        )}
        <footer
          className="input-area"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void upload(e.dataTransfer.files) }}
        >
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => { void upload(e.target.files); e.target.value = '' }}
          />
          <button className="ghost" onClick={() => fileInputRef.current?.click()}>📎</button>
          {speech?.canRecord ? (
            <button
              className={`ghost voice-btn ${recording ? 'recording' : ''}`}
              title={recording ? '松开发送' : '按住说话'}
              style={recording ? { touchAction: 'none' } : undefined}
              onPointerDown={(e) => {
                e.preventDefault()
                // S1：捕获指针，滑出边界不触发 pointerleave，松手仍收到 pointerup
                e.currentTarget.setPointerCapture(e.pointerId)
                recordingRef.current = true
                setRecording(true)
                speechRef.current?.start()
                // M2：60s 上限截断即发送（stop 幂等，无双发）
                window.setTimeout(() => {
                  if (recordingRef.current) void handleSpeechStop()
                }, 60_000)
              }}
              onPointerUp={() => {
                if (recordingRef.current) void handleSpeechStop()
              }}
              onPointerCancel={() => {
                if (recordingRef.current) void handleSpeechStop()
              }}
            >
              🎤
            </button>
          ) : null}
          <button className="ghost" onClick={() => setShowMention((v) => !v)}>@</button>
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
      {showMention && (
        <div className="mention-picker">
          {members.map((mem) => (
            <button key={mem.userId} className="mention-option" onClick={() => { setInput((prev) => prev + (mem.kind === 'agent' ? `@${mem.name} ` : `@${mem.userId} `)); setShowMention(false) }}>
              {mem.kind === 'agent' ? `🤖 ${mem.name}` : mem.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
