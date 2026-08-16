import { buildApp } from './server.js'
import { startScheduler } from './scheduler.js'

const built = await buildApp()
// 自动定时器（FR-APP-06）：进程内 cron 每小时升级超时审批（不进 buildApp——测试环境不启动，避免定时器悬挂）
startScheduler(built.pool, built.config.escalationCron)
const { app, config } = built
try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`gateway listening on http://0.0.0.0:${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
