import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('template routes', () => {
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

  it('lists templates from manifest files', async () => {
    const login = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } })
    const token = login.json().token as string
    const res = await built.app.inject({ method: 'GET', url: '/api/v1/templates', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const ids = (res.json().templates as Array<{ id: string }>).map((t) => t.id)
    expect(ids).toContain('software-delivery')
    expect(ids).toContain('requirements-mgmt')
  })

  it('creates a session with a template and binds its skills', async () => {
    const login = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } })
    const token = login.json().token as string
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '套模板项目', memberIds: ['u-bob'], templateId: 'software-delivery' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.template?.id).toBe('software-delivery')
    expect(body.session.templateId).toBe('software-delivery')
    // 技能包绑定审计留痕
    const audit = await pool.query<{ action: string; detail: unknown }>(
      "SELECT action, detail FROM audit_events WHERE action = 'session.skill_bound' AND target = $1 ORDER BY id",
      [body.session.id],
    )
    expect(audit.rows.length).toBe(2) // pm + fullstack
  })

  it('rejects an unknown template id', async () => {
    const login = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } })
    const token = login.json().token as string
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '坏模板', memberIds: ['u-bob'], templateId: 'nope' },
    })
    expect(res.statusCode).toBe(400)
  })
})
