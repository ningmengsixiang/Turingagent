import cron from 'node-cron'
import pg from 'pg'
import { escalateOverdueApprovals } from './repos/approvals.js'
import { escalationRunsTotal } from './metrics.js'

/** 执行一轮超时升级（供调度与测试直接调用） */
export async function runEscalationTick(pool: pg.Pool, now?: Date): Promise<number> {
  const escalated = await escalateOverdueApprovals(pool, now)
  if (escalated.length > 0) {
    escalationRunsTotal.inc(escalated.length)
    console.info(`[scheduler] escalated ${escalated.length} overdue approval(s): ${escalated.map((a) => a.id).join(', ')}`)
  }
  return escalated.length
}

/** 启动 cron 调度（默认每小时；返回 disposer 供停止） */
export function startScheduler(pool: pg.Pool, cronExpr = '0 * * * *'): { stop: () => void } {
  const task = cron.schedule(cronExpr, () => {
    void runEscalationTick(pool).catch((err) => console.error('[scheduler] escalation tick failed:', err))
  })
  console.info(`[scheduler] escalation cron started: ${cronExpr}`)
  return { stop: () => task.stop() }
}
