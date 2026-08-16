import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import FormData from 'form-data'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('file routes', () => {
  let built: BuiltApp
  let pool: pg.Pool

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
    built = await buildApp({ databaseUrl: 'postgres://ta:ta@localhost:5432/ta_dev' })
  })
  afterEach(async () => {
    await built.app.close()
  })

  async function loginAs(username: string): Promise<string> {
    const res = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username } })
    return res.json().token as string
  }

  async function createProjectSession(token: string): Promise<string> {
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    return res.json().session.id as string
  }

  it('uploads a file and creates a file message', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const form = new FormData()
    form.append('file', Buffer.from('hello file content'), { filename: '需求文档.txt', contentType: 'text/plain' })
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/files`,
      headers: { authorization: `Bearer ${alice}`, ...form.getHeaders() },
      payload: form.getBuffer(),
    })
    expect(res.statusCode).toBe(201)
    const { file, message } = res.json()
    expect(file.name).toBe('需求文档.txt')
    expect(file.size).toBeGreaterThan(0)
    expect(message.contentType).toBe('file')
    expect(message.content).toBe('需求文档.txt')
  })

  it('returns a download url for a file', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const form = new FormData()
    form.append('file', Buffer.from('download me'), { filename: 'a.txt', contentType: 'text/plain' })
    const upload = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/files`,
      headers: { authorization: `Bearer ${alice}`, ...form.getHeaders() },
      payload: form.getBuffer(),
    })
    const fileId = upload.json().file.id as string
    const res = await built.app.inject({
      method: 'GET',
      url: `/api/v1/files/${fileId}`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.url).toContain('X-Amz-Signature') // 预签名 URL
  })
})
