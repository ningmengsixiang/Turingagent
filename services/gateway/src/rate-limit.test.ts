import { describe, expect, it } from 'vitest'
import { createMemoryRateLimiter, createRedisRateLimiter } from './rate-limit.js'
import { Redis } from 'ioredis'

describe('rate limiter (memory)', () => {
  it('allows within limit and rejects over', async () => {
    const limiter = createMemoryRateLimiter(3, 60_000)
    expect((await limiter.check('k1')).allowed).toBe(true)
    expect((await limiter.check('k1')).allowed).toBe(true)
    expect((await limiter.check('k1')).allowed).toBe(true)
    const fourth = await limiter.check('k1')
    expect(fourth.allowed).toBe(false)
  })

  it('isolates keys', async () => {
    const limiter = createMemoryRateLimiter(2, 60_000)
    await limiter.check('a')
    await limiter.check('a')
    expect((await limiter.check('b')).allowed).toBe(true)
    expect((await limiter.check('a')).allowed).toBe(false)
  })

  it('resets after window', async () => {
    const limiter = createMemoryRateLimiter(1, 1000)
    await limiter.check('k')
    expect((await limiter.check('k')).allowed).toBe(false)
    await new Promise((r) => setTimeout(r, 1100))
    expect((await limiter.check('k')).allowed).toBe(true)
  })
})

// Redis 后端：本地真实 Redis 验证（REDIS_TEST=1 启用；CI 无 Redis 自动跳过）
const redisTest = process.env.REDIS_TEST === '1'
describe.skipIf(!redisTest)('rate limiter (redis)', () => {
  it('counts via redis and rejects over limit', async () => {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
    try {
      const limiter = createRedisRateLimiter(redis, 2, 60)
      expect((await limiter.check('rt')).allowed).toBe(true)
      expect((await limiter.check('rt')).allowed).toBe(true)
      expect((await limiter.check('rt')).allowed).toBe(false)
    } finally {
      redis.disconnect()
    }
  })
})
