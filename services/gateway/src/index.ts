import { buildApp } from './server.js'
import { startScheduler } from './scheduler.js'

const built = await buildApp()
// 自动定时器（FR-APP-06）：进程内 cron 每小时升级超时审批（不进 buildApp——测试环境不启动，避免定时器悬挂）
const scheduler = startScheduler(built.pool, built.config.escalationCron)
const { app, config, pool } = built

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[gateway] received ${signal}, shutting down...`)
  // 停止定时器 → 停止接收新连接 → 释放连接池（超时兜底）
  const timer = setTimeout(() => {
    console.error('[gateway] shutdown timed out, forcing exit')
    process.exit(1)
  }, 10_000)
  timer.unref()
  try {
    scheduler.stop()
    await app.close()
    // server.ts 的 onClose 钩子已执行 pool.end()（app.close 时）；此处显式兜底。
    // pg-pool 重复 end 抛 'Called end on pool more than once'——池已释放则吞掉（进程照常 exit 0）
    try {
      await pool.end()
    } catch {
      // pool 已由 app close 钩子释放（services/gateway/src/server.ts onClose → pool.end()）
    }
    console.log('[gateway] shutdown complete')
    process.exit(0)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`gateway listening on http://0.0.0.0:${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
