import { describe, expect, it } from 'vitest'
import { buildApp } from './server.js'

describe('gateway http', () => {
  it('GET /healthz returns ok', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
    await app.close()
  })

  it('login requires username', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: {} })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('login returns token and user', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(typeof body.token).toBe('string')
    expect(body.user.name).toBe('alice')
    await app.close()
  })

  it('GET /me requires token', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('GET /me returns user with valid token', async () => {
    const { app } = await buildApp()
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bob' } })
    const { token } = login.json()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.name).toBe('bob')
    await app.close()
  })

  it('GET /me rejects invalid token', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: 'Bearer not-a-jwt' } })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('login rejects non-string username with 400', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 123 } })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('login rejects overly long username with 400', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'u'.repeat(1000) } })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('login rejects username with illegal characters with 400', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'bad name!' } })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('GET /me returns 401 for expired token', async () => {
    const { app } = await buildApp({ jwtExpiresIn: '1s' })
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'eve' } })
    const { token } = login.json()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
