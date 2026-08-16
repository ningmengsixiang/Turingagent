import pg from 'pg'
import type { QuotaStatus } from '@ta/contracts'

export interface QuotaRow {
  budget: string
  updated_at: Date
}

export async function getQuota(pool: pg.Pool): Promise<QuotaStatus> {
  const cfg = await pool.query<QuotaRow>('SELECT budget, updated_at FROM quota_config WHERE id = 1')
  const budget = Number(cfg.rows[0]?.budget ?? 0)
  const usedRes = await pool.query<{ total: string }>('SELECT COALESCE(SUM(tokens), 0) AS total FROM agent_usage')
  const used = Number(usedRes.rows[0]?.total ?? 0)
  return {
    level: 'enterprise',
    budget,
    used,
    ratio: budget > 0 ? used / budget : 1,
    // 契约注释：tripped = used >= budget（调额为 0 即 100% 已用 → 熔断；计划配额.ts 原文为
    // `budget > 0 && used >= budget`，会使「预算调为 0 → 熔断」用例失效且与契约注释矛盾，见汇报适配）
    tripped: used >= budget,
  }
}

/** 累计某 agent 用量；返回最新配额状态 */
export async function recordUsage(pool: pg.Pool, agentId: string, tokens: number): Promise<QuotaStatus> {
  await pool.query(
    `INSERT INTO agent_usage (agent_id, tokens) VALUES ($1, $2)
     ON CONFLICT (agent_id) DO UPDATE SET tokens = agent_usage.tokens + EXCLUDED.tokens, updated_at = now()`,
    [agentId, Math.max(0, Math.round(tokens))],
  )
  return getQuota(pool)
}

/** 熔断检查：已熔断则返回提示文本，否则 null */
export async function checkQuota(pool: pg.Pool): Promise<string | null> {
  const quota = await getQuota(pool)
  if (quota.tripped) return `⚠️ 配额已熔断（用量 ${quota.used}/${quota.budget} tokens）。请联系管理员调额后重试。`
  return null
}

/** 调额（管理员操作；RBAC 完整化前允许所有登录用户，审计留痕） */
export async function setQuotaBudget(pool: pg.Pool, budget: number): Promise<QuotaStatus> {
  if (!Number.isFinite(budget) || budget < 0) throw new Error('budget must be a non-negative number')
  await pool.query(
    `UPDATE quota_config SET budget = $1, updated_at = now() WHERE id = 1`,
    [Math.round(budget)],
  )
  return getQuota(pool)
}
