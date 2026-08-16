import type { Approval, FileInfo, Memory, MemoryVersion, Message, Session, SessionMember, Task, TaskStatus } from '@ta/contracts'

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
    // 401 → 通知 UI 回到登录页（token 过期后不卡在聊天页）
    window.dispatchEvent(new Event('ta:unauthorized'))
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

export const login = async (username: string): Promise<LoginResponse> => {
  const res = await request<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username }),
  })
  // 登录成功即存 token：login 自身负责存储，调用方不需重复 setToken
  setToken(res.token)
  return res
}

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
  input: { clientMsgId: string; contentType: string; content: string; replyTo?: string },
): Promise<{ message: Message }> =>
  request(`/api/v1/sessions/${sessionId}/messages`, { method: 'POST', body: JSON.stringify(input) })

export const createApproval = (
  sessionId: string,
  input: { title: string; description?: string; approverId: string },
): Promise<{ approval: Approval; cardMessage: Message }> =>
  request(`/api/v1/sessions/${sessionId}/approvals`, { method: 'POST', body: JSON.stringify(input) })

export const decideApproval = (
  approvalId: string,
  input: { decision: 'approved' | 'rejected'; reason?: string },
): Promise<{ approval: Approval }> =>
  request(`/api/v1/approvals/${approvalId}/decide`, { method: 'POST', body: JSON.stringify(input) })

export const getApproval = (approvalId: string): Promise<{ approval: Approval }> =>
  request(`/api/v1/approvals/${approvalId}`)

export const transferApproval = (approvalId: string, newApproverId: string): Promise<{ approval: Approval }> =>
  request(`/api/v1/approvals/${approvalId}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ newApproverId }),
  })

export const returnApproval = (approvalId: string, reason: string): Promise<{ approval: Approval }> =>
  request(`/api/v1/approvals/${approvalId}/return`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })

export const resubmitApproval = (approvalId: string): Promise<{ approval: Approval }> =>
  request(`/api/v1/approvals/${approvalId}/resubmit`, { method: 'POST' })

export const cancelApproval = (approvalId: string): Promise<{ approval: Approval }> =>
  request(`/api/v1/approvals/${approvalId}/cancel`, { method: 'POST' })

export const createTask = (
  sessionId: string,
  input: { title: string; assigneeId: string; assigneeKind: 'human' | 'agent'; dueAt?: string },
): Promise<{ task: Task; cardMessage: Message }> =>
  request(`/api/v1/sessions/${sessionId}/tasks`, { method: 'POST', body: JSON.stringify(input) })

export const updateTaskStatus = (taskId: string, status: TaskStatus): Promise<{ task: Task }> =>
  request(`/api/v1/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })

export const listTasks = (sessionId: string): Promise<{ tasks: Task[] }> =>
  request(`/api/v1/sessions/${sessionId}/tasks`)

export const listMemories = (sessionId: string): Promise<{ memories: Memory[] }> =>
  request(`/api/v1/sessions/${sessionId}/memories`)

export const createMemory = (
  sessionId: string,
  input: { title: string; content: string },
): Promise<{ memory: Memory }> =>
  request(`/api/v1/sessions/${sessionId}/memories`, { method: 'POST', body: JSON.stringify(input) })

export const updateMemory = (
  memoryId: string,
  input: { title?: string; content: string },
): Promise<{ memory: Memory }> => request(`/api/v1/memories/${memoryId}`, { method: 'PUT', body: JSON.stringify(input) })

export const listMemoryVersions = (memoryId: string): Promise<{ versions: MemoryVersion[] }> =>
  request(`/api/v1/memories/${memoryId}/versions`)

export const summarizeMemory = (sessionId: string): Promise<{ memory: Memory }> =>
  request(`/api/v1/sessions/${sessionId}/memories/summarize`, { method: 'POST' })

export const listSessionMembers = (sessionId: string): Promise<{ members: SessionMember[] }> =>
  request(`/api/v1/sessions/${sessionId}/members`)

export const uploadFile = async (sessionId: string, file: File): Promise<{ file: FileInfo; message: Message }> => {
  const token = getToken()
  const form = new FormData()
  form.append('file', file, file.name)
  const res = await fetch(`/api/v1/sessions/${sessionId}/files`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  })
  if (res.status === 401) {
    clearToken()
    // 与 request() 保持一致：401 → 通知 UI 回到登录页
    window.dispatchEvent(new Event('ta:unauthorized'))
    throw new Error('unauthorized')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `http ${res.status}`)
  }
  return (await res.json()) as { file: FileInfo; message: Message }
}

export const getFileDownloadUrl = (fileId: string): Promise<{ url: string; file: FileInfo }> =>
  request(`/api/v1/files/${fileId}`)
