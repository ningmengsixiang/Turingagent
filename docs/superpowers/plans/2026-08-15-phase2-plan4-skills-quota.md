# Phase 2 · 计划 15：技能包管理 + 配额熔断（M2.4 / FR-ORG-04 / FR-ORG-07）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地智能体治理（M2.4/FR-ORG-04/07/BL-9）：技能包 manifest + 工具白名单注册表（`GET /api/v1/skills`，静态 JSON manifest 热加载）+ 会话技能包绑定；配额三层计量（企业/项目/单任务）与 80% 预警、100% 熔断（agent bridge 每次运行前查预算、超限拒绝并通知；熔断只影响智能体执行，IM 主链路不受影响）。企业知识库（FR-MEM-03，P2）与技能包市场（FR-ECO-01，P2）记入后续计划。

**Architecture:** 技能包用静态 manifest 文件（`services/gateway/skills/<id>.json`，含 id/name/description/toolAllowlist）→ `repos/skills.ts` 读目录注册表（热加载=每次请求重读文件）→ `routes/skills.ts`（GET 列表 + POST /sessions/:id/skills 绑定）+ 契约 `Skill` 类型。配额：迁移 009 `agent_usage` 表（agent_id/tokens 累计）→ `repos/quota.ts`（累计用量 + 预算检查）→ AgentBridge 每次 run 前 `checkQuota`（超限返回「⚠️ 配额熔断」回复、不调 provider）、run 后 `recordUsage`；`POST /api/v1/org/quota` 调额（管理员）→ 熔断恢复。80% 预警 = 返回时附带 usage 字段（前端展示），100% 熔断 = bridge 拦截。

**Tech Stack:** 无新依赖。Node fs 读 manifest + PG（agent_usage 表）+ Fastify 路由 + AgentBridge 集成。

**质量审查决策（T2-T4 后追加）：** ① `tripped: used >= budget`（计划原文 `budget > 0 &&` 使预算=0 永不熔断，与契约注释及熔断用例矛盾——修正）；② POST 调额端点用 `adminOnly`（users 仓储已有 admin/member 角色机制，符合决策记录「admin 角色校验」），GET 配额用 `auth`（登录可见）；③ test-helpers truncate 增 agent_usage、刻意保留 quota_config（迁移默认预算行，防全量熔断）；④ 熔断用例额外断言 provider.calls=0（真实验证未调 LLM）。**记录 nit（后续）**：setQuotaBudget 无自愈 INSERT（quota_config 行丢失 → 永久熔断，建议加 ON CONFLICT DO NOTHING）；listSkills 排序在 try/catch 外（缺 id manifest 会使列表 500）；org quota 端点无直接路由测试；GET 端点提前到 Task 3 落地（无害重排）。

**决策记录：** 技能包 MVP 用静态 manifest 文件（零 DB、文件即真源、热加载=重读；技能包市场/安装流程记 Phase 2 后续）；工具白名单为声明式元数据（当前 agent 无真实工具执行——工具执行层在 D1 改判 B（自建编排层）时落地，manifest 先行）；配额三层简化为「企业级总量」一级计量（项目/单任务子配额记 Phase 2 后续，避免过度建模；契约保留 level 字段扩展）；80% 预警为返回 usage 比例（前端配额条展示，L2 通知记后续）；熔断仅拦截 provider 调用（人类消息/IM 不受影响，PRD 硬约束）；管理员调额端点无 RBAC 角色校验（MVP 演示登录仅 member/admin 两级，用 admin 角色校验——先核对 users 角色现状，若无 admin 角色机制则记录并允许 member 调用，Phase 2 RBAC 完整化时收紧）；agent 用量按 agent.id 累计（无用户维度——单机 MVP 够用，多租户记 Phase 3）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `packages/contracts/src/index.ts` | 修改 | `Skill` 类型 + `QuotaStatus` |
| `services/gateway/skills/fullstack.json` | 创建 | 技能包 manifest 示例（工具白名单） |
| `services/gateway/skills/pm.json` | 创建 | 技能包 manifest 示例 |
| `services/gateway/migrations/009_quota.sql` | 创建 | agent_usage 表 |
| `services/gateway/src/repos/skills.ts` | 创建 | 技能包注册表（读目录） |
| `services/gateway/src/repos/quota.ts` | 创建 | 用量累计 + 预算检查 |
| `services/gateway/src/routes/skills.ts` | 创建 | GET /skills + POST /sessions/:id/skills 绑定 |
| `services/gateway/src/routes/org.ts` | 修改 | POST /api/v1/org/quota 调额 |
| `services/gateway/src/agent/bridge.ts` | 修改 | run 前 checkQuota + run 后 recordUsage + 熔断回复 |
| `services/gateway/src/agent/bridge.test.ts` | 修改 | 熔断用例 |
| `services/gateway/src/server.ts` | 修改 | 注册 skills 路由 + 传 quota 依赖 |
| `apps/web/src/api/client.ts` | 修改 | listSkills/getQuota API |
| `apps/web/src/pages/Chat.tsx` | 修改 | 技能包列表展示 + 配额条 |
| `apps/web/src/pages/Chat.test.tsx` | 修改 | 技能包/配额用例 |
| `README.md` | 修改 | 技能包与配额说明 |

---

## Task 1: 契约 + 迁移 + manifest

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `services/gateway/migrations/009_quota.sql`
- Create: `services/gateway/skills/fullstack.json`
- Create: `services/gateway/skills/pm.json`

- [ ] **Step 1: 契约扩展**

读 `packages/contracts/src/index.ts`，在文件末尾（`FileInfo` 之后）追加：

```ts
export interface Skill {
  id: string
  name: string
  description: string
  /** 工具白名单（声明式元数据；实际工具执行层 Phase 2 落地） */
  toolAllowlist: string[]
}

export const QuotaLevel = {
  Enterprise: 'enterprise',
  Project: 'project',
  Task: 'task',
} as const
export type QuotaLevel = (typeof QuotaLevel)[keyof typeof QuotaLevel]

export interface QuotaStatus {
  level: QuotaLevel
  /** 预算（tokens） */
  budget: number
  /** 已用（tokens） */
  used: number
  /** 0-1 比例 */
  ratio: number
  /** 是否熔断（used >= budget） */
  tripped: boolean
}
```

- [ ] **Step 2: 迁移 009**

创建 `services/gateway/migrations/009_quota.sql`，内容逐字如下：

```sql
-- 智能体配额计量（FR-ORG-07）：agent_usage 按 agent 累计 token 用量
CREATE TABLE IF NOT EXISTS agent_usage (
  agent_id TEXT PRIMARY KEY,
  tokens BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 配额配置（单行：企业级默认预算；调额端点更新）
CREATE TABLE IF NOT EXISTS quota_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  budget BIGINT NOT NULL DEFAULT 1000000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO quota_config (id, budget) VALUES (1, 1000000)
  ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 3: 写 manifest**

创建 `services/gateway/skills/fullstack.json`：

```json
{
  "id": "fullstack",
  "name": "全栈开发",
  "description": "软件生成与交付：代码编写、测试、部署编排",
  "toolAllowlist": ["read", "write", "edit", "bash", "web_search", "subagent"]
}
```

创建 `services/gateway/skills/pm.json`：

```json
{
  "id": "pm",
  "name": "项目管理",
  "description": "需求澄清与流程推进：需求分析、任务拆解、评审组织",
  "toolAllowlist": ["read", "write", "bash", "web_search"]
}
```

- [ ] **Step 4: 构建 + 迁移**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway migrate
```

Expected: contracts build exit 0；typecheck exit 0（新增类型无消费方，无报错）；migrate 应用 009。

- [x] **Step 5: 提交**

```bash
git add packages/contracts services/gateway/migrations/009_quota.sql services/gateway/skills
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(skill): 契约 Skill/QuotaStatus + 迁移 009 + manifest 示例"
```

---

## Task 2: 技能包注册表 + 路由

**Files:**
- Create: `services/gateway/src/repos/skills.ts`
- Create: `services/gateway/src/routes/skills.ts`
- Create: `services/gateway/src/routes/skills.test.ts`
- Modify: `services/gateway/src/server.ts`

- [x] **Step 1: 写 repos/skills.ts**

创建 `services/gateway/src/repos/skills.ts`，内容逐字如下：

```ts
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Skill } from '@ta/contracts'

const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../skills')

/** 技能包注册表：每次调用重读目录（热加载——新增/修改 manifest 即时生效） */
export function listSkills(): Skill[] {
  const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.json'))
  const skills: Skill[] = []
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(path.join(SKILLS_DIR, f), 'utf8')) as Skill
      skills.push(raw)
    } catch (err) {
      console.error(`[skills] failed to load ${f}:`, err)
    }
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id))
}

export function getSkill(id: string): Skill | null {
  return listSkills().find((s) => s.id === id) ?? null
}
```

- [x] **Step 2: 写 routes/skills.ts**

创建 `services/gateway/src/routes/skills.ts`，内容逐字如下：

```ts
import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware.js'
import { isMember } from '../repos/sessions.js'
import { listSkills, getSkill } from '../repos/skills.js'
import { recordAudit } from '../repos/audit.js'
import pg from 'pg'
import type { Config } from '../config.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerSkillRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const auth = requireAuth(config, pool)

  // 技能包列表（热加载）
  app.get('/api/v1/skills', { preHandler: auth }, async () => {
    return { skills: listSkills() }
  })

  // 会话绑定技能包（记录到 audit；绑定关系后续用于工具白名单下发）
  app.post<{ Params: { id: string }; Body: { skillId?: string } }>(
    '/api/v1/sessions/:id/skills',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      if (!UUID_PATTERN.test(sessionId)) {
        return reply.code(400).send({ error: 'session id must be a uuid' })
      }
      const skillId = request.body?.skillId?.trim()
      if (!skillId) return reply.code(400).send({ error: 'skillId is required' })
      if (!getSkill(skillId)) return reply.code(400).send({ error: `skill ${skillId} not found` })
      if (!(await isMember(pool, sessionId, request.user!.id))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      void recordAudit(pool, {
        actorId: request.user!.id,
        action: 'session.skill_bound',
        target: sessionId,
        detail: { skillId },
      }).catch((err) => console.error('[audit] skill bind failed:', err))
      return { bound: true, skill: getSkill(skillId) }
    },
  )
}
```

- [x] **Step 3: 写 skills.test.ts**

创建 `services/gateway/src/routes/skills.test.ts`，内容逐字如下（复用既有路由测试风格——先读 routes/approvals.test.ts 或 files.test.ts 的 setup：buildApp/登录/建会话 helper）：

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('skill routes', () => {
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

  it('lists skills from manifest files', async () => {
    const res = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } })
    const token = res.json().token as string
    const list = await built.app.inject({
      method: 'GET',
      url: '/api/v1/skills',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(list.statusCode).toBe(200)
    const ids = (list.json().skills as Array<{ id: string }>).map((s) => s.id)
    expect(ids).toContain('fullstack')
    expect(ids).toContain('pm')
  })

  it('binds a skill to a session', async () => {
    const login = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } })
    const token = login.json().token as string
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skillId: 'fullstack' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().skill.name).toBe('全栈开发')
  })

  it('rejects an unknown skill id', async () => {
    const login = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice' } })
    const token = login.json().token as string
    const session = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    const sessionId = session.json().session.id as string
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skillId: 'nope' },
    })
    expect(res.statusCode).toBe(400)
  })
})
```

- [x] **Step 4: server.ts 注册**

读 `services/gateway/src/server.ts`，在 `registerOrgRoutes(app, config, pool)` 之后增：

```ts
  registerSkillRoutes(app, config, pool)
```

（import 增 `registerSkillRoutes` from `./routes/skills.js`。）

- [x] **Step 5: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose src/routes/skills.test.ts
```

Expected: typecheck exit 0；skills.test.ts 3 用例全 PASS。

- [x] **Step 6: 提交**

```bash
git add services/gateway/src/repos/skills.ts services/gateway/src/routes/skills.ts services/gateway/src/routes/skills.test.ts services/gateway/src/server.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(skill): 技能包注册表（热加载）+ 列表/绑定路由"
```

---

## Task 3: 配额计量 + 熔断

**Files:**
- Create: `services/gateway/src/repos/quota.ts`
- Modify: `services/gateway/src/agent/bridge.ts`
- Modify: `services/gateway/src/agent/bridge.test.ts`
- Modify: `services/gateway/src/routes/org.ts`
- Modify: `services/gateway/src/server.ts`

- [x] **Step 1: 写 repos/quota.ts**

创建 `services/gateway/src/repos/quota.ts`，内容逐字如下：

```ts
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
    tripped: budget > 0 && used >= budget,
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
```

- [x] **Step 2: bridge.ts 集成熔断**

读 `services/gateway/src/agent/bridge.ts`，做三处修改：

1. import 增：`import { checkQuota, recordUsage } from '../repos/quota.js'`。

2. `AgentBridgeOptions` 增 `maxQuotaRatio?: number`（80% 预警阈值，可选，默认 0.8）——本计划只用于返回 usage 展示，不强制。

3. `handle()` 中 `runAgent` 调用前（hit 分支与静默策略 respond 分支都要）加熔断检查。把 `runAgent` 改为：调用 provider 前先 `const trip = await checkQuota(this.options.pool); if (trip) { 发熔断消息; return }`，成功回执后 `void recordUsage(pool, agent.id, completion.promptTokens + completion.completionTokens)`。具体改法：

```ts
  private async runAgent(
    message: Message,
    agent: AgentDefinition,
    requirement: string,
  ): Promise<MentionResult> {
    // 配额熔断（FR-ORG-07）：熔断只影响智能体执行，IM 主链路不受影响
    const trip = await checkQuota(this.options.pool)
    if (trip) {
      try {
        const { message: reply } = await createMessage(this.options.pool, {
          sessionId: message.sessionId,
          senderId: agent.id,
          senderKind: 'agent',
          contentType: 'text',
          content: trip,
          clientMsgId: `agent-${randomUUID()}`,
        })
        this.options.emitMessageCreated(reply)
        return { triggered: true, agentId: agent.id, reply, skippedReason: 'quota' }
      } catch (err) {
        console.error('[agent] failed to persist quota reply:', err)
        return { triggered: false, skippedReason: 'quota' }
      }
    }
    const systemPrompt = agent.persona.replaceAll('{{cwd}}', process.cwd())
    try {
      const completion = await this.options.provider.complete(systemPrompt, requirement)
      console.log(
        `[agent] ${agent.displayName} run: prompt=${completion.promptTokens} completion=${completion.completionTokens} tokens`,
      )
      // 用量累计（agent 维度）
      void recordUsage(this.options.pool, agent.id, completion.promptTokens + completion.completionTokens).catch((err) =>
        console.error('[quota] record usage failed:', err),
      )
      const { message: reply } = await createMessage(this.options.pool, {
        sessionId: message.sessionId,
        senderId: agent.id,
        senderKind: 'agent',
        contentType: 'text',
        content: completion.content,
        clientMsgId: `agent-${randomUUID()}`,
      })
      this.options.emitMessageCreated(reply)
      return { triggered: true, agentId: agent.id, reply }
    } catch (err) {
      // 原 error reply 逻辑不变
      console.error('[agent] run failed:', err)
      try {
        const { message: reply } = await createMessage(this.options.pool, {
          sessionId: message.sessionId,
          senderId: agent.id,
          senderKind: 'agent',
          contentType: 'text',
          content: `⚠️ ${agent.displayName} 处理失败，请稍后重试。`,
          clientMsgId: `agent-${randomUUID()}`,
        })
        this.options.emitMessageCreated(reply)
        return { triggered: true, agentId: agent.id, reply, skippedReason: 'error' }
      } catch (replyErr) {
        console.error('[agent] failed to persist error reply:', replyErr)
        return { triggered: false, skippedReason: 'error' }
      }
    }
  }
```

（`MentionResult.skippedReason` 联合类型增 `'quota'`。）

- [x] **Step 3: org.ts 增调额端点**

读 `services/gateway/src/routes/org.ts`，追加：

```ts
  app.post<{ Body: { budget?: number } }>(
    '/api/v1/org/quota',
    { preHandler: auth },
    async (request, reply) => {
      const budget = request.body?.budget
      if (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 0) {
        return reply.code(400).send({ error: 'budget must be a non-negative number' })
      }
      try {
        const quota = await setQuotaBudget(pool, budget)
        void recordAudit(pool, {
          actorId: request.user!.id,
          action: 'quota.updated',
          target: 'enterprise',
          detail: { budget },
        }).catch((err) => console.error('[audit] quota update failed:', err))
        return { quota }
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'invalid budget' })
      }
    },
  )
```

（import 增 setQuotaBudget、recordAudit；auth 已存在。）

- [x] **Step 4: bridge.test.ts 补熔断用例**

读 `services/gateway/src/agent/bridge.test.ts`（setup：StubProvider/临时池），追加：

```ts
  it('trips quota and replies with a quota message instead of calling the provider', async () => {
    // 先把预算调为 0 → 熔断
    const { setQuotaBudget } = await import('../repos/quota.js')
    await setQuotaBudget(pool, 0)
    const res = await bridge.handle({
      /* content: '这个方案你定吧'（决策点，走静默策略 respond → runAgent） */
    } as Message)
    expect(res.triggered).toBe(true)
    expect(res.skippedReason).toBe('quota')
    expect(res.reply?.content).toContain('配额已熔断')
    // 恢复预算，避免污染其他用例
    await setQuotaBudget(pool, 1000000)
  })

  it('records usage after a successful run', async () => {
    const { getQuota } = await import('../repos/quota.js')
    const before = await getQuota(pool)
    const res = await bridge.handle({
      /* content: '这个方案你定吧' */
    } as Message)
    expect(res.triggered).toBe(true)
    const after = await getQuota(pool)
    expect(after.used).toBeGreaterThan(before.used)
  })
```

（`pool` 与 `bridge` 变量名以现有测试为准；`as Message` 字面量沿用现有风格。）

- [x] **Step 5: server.ts 传 quota 相关（无改动即可——bridge 内部用 pool 访问 quota）**

核对：bridge 已有 pool 依赖，`checkQuota(pool)`/`recordUsage(pool, ...)` 直接用 options.pool，无需 server.ts 改动。org.ts 已注册（server.ts 现有 registerOrgRoutes）。

- [x] **Step 6: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose src/agent/bridge.test.ts src/routes/org.test.ts
```

Expected: typecheck exit 0；bridge.test.ts 14 用例（12 + 2 新增）、org.test.ts 既有用例全 PASS。注意：既有 bridge 用例在 runAgent 前多了 checkQuota（预算默认 1000000 不会熔断）与 run 后 recordUsage（写 agent_usage 表）——truncateAll 需含 agent_usage（读 test-helpers.ts 确认 truncate 表清单，若无则加）。

- [x] **Step 7: 提交**

```bash
git add services/gateway/src/repos/quota.ts services/gateway/src/agent/bridge.ts services/gateway/src/agent/bridge.test.ts services/gateway/src/routes/org.ts services/gateway/src/routes/org.test.ts services/gateway/src/repos/test-helpers.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(quota): 配额三层计量 + 80% 预警/100% 熔断 + 调额端点"
```

---

## Task 4: 前端（技能包 + 配额条）

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/Chat.tsx`
- Modify: `apps/web/src/pages/Chat.test.tsx`

- [x] **Step 1: client.ts 增 API**

读 `apps/web/src/api/client.ts`，在文件末尾追加：

```ts
export const listSkills = (): Promise<{ skills: Skill[] }> => request('/api/v1/skills')

export const getQuota = (): Promise<{ quota: QuotaStatus }> => request('/api/v1/org/quota')
```

（import 增 `Skill, QuotaStatus` from '@ta/contracts'；**注意**：`GET /api/v1/org/quota` 端点 Task 3 未定义——本计划在此补充：routes/org.ts 增 `app.get('/api/v1/org/quota', { preHandler: auth }, async () => ({ quota: await getQuota(pool) }))`（import getQuota）。）

- [x] **Step 2: Chat.tsx 展示**

读 `apps/web/src/pages/Chat.tsx`，在右侧面板「看板」之前或之后增「技能包」区（简化为会话加载后拉一次 skills + quota）：

1. 状态增：`const [skills, setSkills] = useState<Skill[]>([])`、`const [quota, setQuota] = useState<QuotaStatus | null>(null)`。
2. 初始化 useEffect（现有 init effect 内或独立）：
```tsx
  useEffect(() => {
    void listSkills().then((r) => setSkills(r.skills)).catch(() => {})
    void getQuota().then((r) => setQuota(r.quota)).catch(() => {})
  }, [])
```
3. 面板渲染（在看板 stats 之后）：
```tsx
            <div className="skill-panel">
              <strong>技能包</strong>
              <div className="skill-list">
                {skills.map((s) => (
                  <span key={s.id} className="skill-chip" title={s.description}>{s.name}</span>
                ))}
              </div>
              {quota ? (
                <div className="quota-bar">
                  <span>配额 {Math.round(quota.ratio * 100)}%{quota.tripped ? ' ⚠️ 已熔断' : ''}</span>
                  <div className="quota-track">
                    <div className={`quota-fill ${quota.tripped ? 'tripped' : quota.ratio >= 0.8 ? 'warn' : ''}`} style={{ width: `${Math.min(100, quota.ratio * 100)}%` }} />
                  </div>
                </div>
              ) : null}
            </div>
```

4. app.css 增样式（skill-panel/skill-chip/quota-bar/quota-track/quota-fill/warn/tripped）——在 kanban 样式后追加。

- [x] **Step 3: Chat.test.tsx 补用例**

在现有用例后追加：

```tsx
  it('shows skill chips and quota bar', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': { messages: [] },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
      '/api/v1/skills': { skills: [{ id: 'fullstack', name: '全栈开发', description: 'd', toolAllowlist: [] }] },
      '/api/v1/org/quota': { quota: { level: 'enterprise', budget: 1000000, used: 500000, ratio: 0.5, tripped: false } },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText(/全栈开发/)).toBeTruthy()
    expect(await screen.findByText(/配额 50%/)).toBeTruthy()
  })
```

（mockFetch key 形式与现有风格一致；若 init effect 在登录后触发，核对渲染时机。）

- [x] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose src/pages/Chat.test.tsx
pnpm --filter @ta/web build
```

Expected: 全 exit 0；Chat.test.tsx 20 用例全 PASS（19 + 1 新增）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/api/client.ts apps/web/src/pages/Chat.tsx apps/web/src/pages/Chat.test.tsx apps/web/src/app.css services/gateway/src/routes/org.ts services/gateway/src/routes/org.test.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(quota): 前端技能包列表 + 配额条"
```

---

## Task 5: README + 全仓验收 + 推送 + 真实验收

- [ ] **Step 1: README 追加「技能包与配额」节**

在 README「### CI/CD 集成（M2.3 / FR-INT-01）」节之后追加：

```markdown
### 技能包与配额（M2.4 / FR-ORG-04 / FR-ORG-07）

技能包 = `services/gateway/skills/<id>.json` manifest（id/name/description/toolAllowlist），热加载（改文件即时生效）：`GET /api/v1/skills` 列表、`POST /sessions/:id/skills` 绑定。配额 = 企业级 token 预算（默认 1,000,000）：智能体每次运行前检查，≥预算即熔断（只影响智能体执行，IM 不受影响）；80% 前端配额条预警。调额：`POST /api/v1/org/quota {budget}`。

```bash
# 查看配额与技能包
curl -s localhost:3001/api/v1/skills -H "authorization: Bearer $TOKEN"
curl -s localhost:3001/api/v1/org/quota -H "authorization: Bearer $TOKEN"
# 调额（示例：降到 100 tokens 观察熔断）
curl -s -X POST localhost:3001/api/v1/org/quota -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"budget":100}'
```
```

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
```

Expected: build 全过；test 全绿（contracts 2 + gateway 164+3+2≈169 + web 32+1≈33 ≈ 204）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净（除 README/计划文档）。

- [ ] **Step 3: 真实验收（技能包 + 配额熔断）**

```bash
cd /tmp
# 1) 登录 → GET /api/v1/skills（应含 fullstack/pm）
# 2) GET /api/v1/org/quota（budget 默认 1000000，used 递增）
# 3) 调额到 0 → 发决策点消息 → agent 回复「配额已熔断」（provider 未被调用——观察日志无 [agent] run）
# 4) 调额恢复 → 再发决策点消息 → 正常回复（真实 DeepSeek）
# 5) GET /api/v1/org/quota → used 递增（recordUsage 生效）
```

Expected: 熔断时回复配额提示且无 LLM 调用；恢复后正常；用量累计。

- [ ] **Step 4: 提交 + 推送**

```bash
git add README.md docs/superpowers/plans/2026-08-15-phase2-plan4-skills-quota.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 15 全部勾选 + README 技能包与配额说明"
git push
```

Expected: 推送成功（CI 应绿）。

---

## Self-Review 记录

- **Spec 覆盖**：FR-ORG-04（智能体管理：技能包/模型/配额）→ 技能包 manifest+绑定（Task 2）+ 配额（Task 3）；FR-ORG-07（三层计量/80% 预警/100% 熔断/熔断不影响 IM）→ Task 3（企业级一级计量，80% 前端展示，熔断仅拦 provider，人类链路不受影响）；PR-6（预算上限与熔断）→ Task 3；「停用智能体」与「模型切换」记 Phase 2 后续（本计划不含 agent 启停/模型切换——roadmap M2.4 全量）。企业知识库（FR-MEM-03 P2）→ 记后续。
- **占位符扫描**：无 TBD；代码逐字给出。
- **类型一致性**：`Skill`（id/name/description/toolAllowlist）在契约/manifest/repos/routes/前端一致；`QuotaStatus`（level/budget/used/ratio/tripped）在契约/repos/quota.ts/路由/前端一致；`skippedReason` 增 `'quota'` 在 bridge.ts/MentionResult 一致。
- **已知取舍**：配额一级计量（项目/任务子配额记 Phase 2 后续）；调额端点 RBAC 宽松（记录，Phase 2 收紧）；技能包绑定仅 audit 留痕（工具白名单下发在工具执行层落地时生效）；80% 预警前端展示（L2 通知记后续）；技能包市场/安装（FR-ECO-01）记后续。
