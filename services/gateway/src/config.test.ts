import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('uses dev secret in test env', () => {
    const config = loadConfig({ NODE_ENV: 'test' })
    expect(config.jwtSecret).toBe('dev-secret-do-not-use-in-prod')
  })

  it('throws with weak or default secret outside test/development', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/)
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/)
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/JWT_SECRET/)
  })

  it('accepts strong secret outside test/development', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(40),
      DATABASE_URL: 'postgres://prod:prod@db:5432/ta_prod',
    })
    expect(config.jwtSecret).toHaveLength(40)
  })

  it('rejects missing or dev DATABASE_URL outside test/development', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) })).toThrow(/DATABASE_URL/)
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(40),
        DATABASE_URL: 'postgres://ta:ta@localhost:5432/ta_dev',
      }),
    ).toThrow(/DATABASE_URL/)
  })

  it('accepts dev DATABASE_URL in development', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).databaseUrl).toBe('postgres://ta:ta@localhost:5432/ta_dev')
  })

  it('rejects invalid PORT', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', PORT: 'abc' })).toThrow(/PORT/)
    expect(() => loadConfig({ NODE_ENV: 'development', PORT: '0' })).toThrow(/PORT/)
    expect(() => loadConfig({ NODE_ENV: 'development', PORT: '70000' })).toThrow(/PORT/)
  })

  it('parses valid PORT', () => {
    expect(loadConfig({ NODE_ENV: 'development', PORT: '8080' }).port).toBe(8080)
  })
})
