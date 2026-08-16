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
  input: { clientMsgId: string; contentType: string; content: string },
): Promise<{ message: Message }> =>
  request(`/api/v1/sessions/${sessionId}/messages`, { method: 'POST', body: JSON.stringify(input) })
