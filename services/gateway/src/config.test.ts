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
    const config = loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) })
    expect(config.jwtSecret).toHaveLength(40)
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
