import type { Redis } from 'ioredis'

export interface RateLimiter {
  check(key: string): Promise<{ allowed: boolean; retryAfterSec: number }>
}

/** 内存固定窗口桶（单副本默认；check 异步化——与 Redis 版接口一致） */
export function createMemoryRateLimiter(limit: number, windowMs = 60_000): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  return {
    async check(key) {
      const now = Date.now()
      const bucket = buckets.get(key)
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs })
        return { allowed: true, retryAfterSec: 0 }
      }
      if (bucket.count >= limit) {
        return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) }
      }
      bucket.count += 1
      return { allowed: true, retryAfterSec: 0 }
    },
  }
}

/** Redis 固定窗口计数（多副本共享；INCR + 首次 EXPIRE；连接失败 incr reject——调用方 catch 降级放行） */
export function createRedisRateLimiter(redis: Redis, limit: number, windowSec = 60): RateLimiter {
  return {
    async check(key) {
      const redisKey = `rl:${key}`
      const count = await redis.incr(redisKey)
      if (count === 1) await redis.expire(redisKey, windowSec)
      if (count > limit) return { allowed: false, retryAfterSec: 0 }
      return { allowed: true, retryAfterSec: 0 }
    },
  }
}
