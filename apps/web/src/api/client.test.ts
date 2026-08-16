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
