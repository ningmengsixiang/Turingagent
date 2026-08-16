# Phase 3 · 计划 23：行业项目模板（M3.1 / FR-ORG-05）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地行业项目模板 MVP（M3.1/FR-ORG-05，P2/BL-1）：预设项目管理模板（manifest：id/name/description/skillIds）→ 新建项目会话一键套用（自动绑定模板技能包，audit 留痕；响应回带模板信息）。审批流模板/角色权限模板记 Phase 3 后续（模板 manifest 预留字段）。

**Architecture:** `services/gateway/templates/<id>.json` manifest（复用 skills 热加载模式）→ `repos/templates.ts`（listTemplates/getTemplate 重读目录）→ 路由 `GET /api/v1/templates`（列表）+ 会话创建路由增可选 `templateId`（校验存在 → 创建会话后逐个绑定模板 skillIds（复用 POST /sessions/:id/skills 的 audit 语义，直接调 skill 绑定逻辑）→ 响应 `{ session, template? }`）→ 契约 `ProjectTemplate` 类型。

**Tech Stack:** 无新依赖。JSON manifest 热加载 + Fastify。

**质量审查决策（T1-T3 后追加）：** ① templateId 仅响应回带不持久化（sessions 表无 template_id 列——已记录取舍，持久化需迁移记 Phase 3 后续）；② 响应合并 departmentId（计划 snippet 会丢 departmentId，实现补合并为正向修正）；③ 模板绑定语义与计划 15 的 POST /sessions/:id/skills 同构（audit 声明性记录，工具执行层消费）。**记录后续**：templateId 持久化（sessions.template_id 迁移）；前端模板选择器；模板扩充（审批流/角色模板消费 approvalFlow/roles 字段）。

**决策记录：** 模板 MVP 聚焦「技能包预设」（复用既有 skills 系统，零新表）；审批流模板/角色权限模板以 manifest 预留 `approvalFlow?`/`roles?` 字段（仅元数据，Phase 3 后续在审批创建时消费）；模板 manifest 热加载（改文件即时生效，与 skills 同模式）；会话创建套用模板 = 绑定模板的 skillIds（多 skillIds 逐个绑定 + audit）；无 templateId 时行为不变（向后兼容）；模板列表登录可见（非敏感）。行业模板集合初始 2 个（软件交付/需求管理），后续扩充。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `packages/contracts/src/index.ts` | 修改 | ProjectTemplate 类型 |
| `services/gateway/templates/software-delivery.json` | 创建 | 软件交付模板 manifest |
| `services/gateway/templates/requirements-mgmt.json` | 创建 | 需求管理模板 manifest |
| `services/gateway/src/repos/templates.ts` | 创建 | 模板注册表（热加载） |
| `services/gateway/src/routes/templates.ts` | 创建 | GET /api/v1/templates |
| `services/gateway/src/routes/sessions.ts` | 修改 | 创建接受 templateId + 绑定技能包 |
| `services/gateway/src/routes/templates.test.ts` | 创建 | 模板路由 + 套用测试 |
| `services/gateway/src/server.ts` | 修改 | 注册模板路由 |
| `README.md` | 修改 | 项目模板说明 |

---

## Task 1: 契约 + manifest + 注册表 + 列表路由

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `services/gateway/templates/software-delivery.json`
- Create: `services/gateway/templates/requirements-mgmt.json`
- Create: `services/gateway/src/repos/templates.ts`
- Create: `services/gateway/src/routes/templates.ts`
- Modify: `services/gateway/src/server.ts`

- [x] **Step 1: 契约**

读 `packages/contracts/src/index.ts`，文件末尾（ApiKeyInfo 之后）追加：

```ts
export interface ProjectTemplate {
  id: string
  name: string
  description: string
  /** 模板预设技能包 */
  skillIds: string[]
  /** 预留：审批流模板（Phase 3 后续消费） */
  approvalFlow?: unknown
  /** 预留：角色权限模板（Phase 3 后续消费） */
  roles?: unknown
}
```

- [x] **Step 2: manifest**

创建 `services/gateway/templates/software-delivery.json`：

```json
{
  "id": "software-delivery",
  "name": "软件交付",
  "description": "软件需求到交付的标准流程：需求澄清、技术评审、编码交付、测试验收",
  "skillIds": ["pm", "fullstack"],
  "approvalFlow": null,
  "roles": null
}
```

创建 `services/gateway/templates/requirements-mgmt.json`：

```json
{
  "id": "requirements-mgmt",
  "name": "需求管理",
  "description": "需求收集、变更管理、影响评估与基线同步",
  "skillIds": ["pm"],
  "approvalFlow": null,
  "roles": null
}
```

- [x] **Step 3: repos/templates.ts**

创建 `services/gateway/src/repos/templates.ts`：

```ts
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProjectTemplate } from '@ta/contracts'

const TEMPLATES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../templates')

/** 模板注册表：每次调用重读（热加载，与 skills 同模式） */
export function listTemplates(): ProjectTemplate[] {
  const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json'))
  const templates: ProjectTemplate[] = []
  for (const f of files) {
    try {
      templates.push(JSON.parse(readFileSync(path.join(TEMPLATES_DIR, f), 'utf8')) as ProjectTemplate)
    } catch (err) {
      console.error(`[templates] failed to load ${f}:`, err)
    }
  }
  return templates.sort((a, b) => a.id.localeCompare(b.id))
}

export function getTemplate(id: string): ProjectTemplate | null {
  return listTemplates().find((t) => t.id === id) ?? null
}
```

- [x] **Step 4: routes/templates.ts**

创建 `services/gateway/src/routes/templates.ts`：

```ts
import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware.js'
import { listTemplates } from '../repos/templates.js'
import type { Config } from '../config.js'
import pg from 'pg'

export function registerTemplateRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const auth = requireAuth(config, pool)

  app.get('/api/v1/templates', { preHandler: auth }, async () => {
    return { templates: listTemplates() }
  })
}
```

- [x] **Step 5: server.ts 注册**

读 `services/gateway/src/server.ts`，在 `registerApiKeyRoutes(app, config, pool)` 之后增：

```ts
  registerTemplateRoutes(app, config, pool)
```

（import 增 `registerTemplateRoutes`。）

- [x] **Step 6: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
```

Expected: typecheck exit 0。

- [x] **Step 7: 提交**

```bash
git add packages/contracts services/gateway/templates services/gateway/src/repos/templates.ts services/gateway/src/routes/templates.ts services/gateway/src/server.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(template): 项目模板 manifest + 注册表 + 列表路由"
```

---

## Task 2: 会话创建套用模板

**Files:**
- Modify: `services/gateway/src/routes/sessions.ts`

- [x] **Step 1: 创建接受 templateId + 绑定技能包**

读 `services/gateway/src/routes/sessions.ts` 创建路由（现有 departmentId/跨租户成员校验后），修改：

1. Body 类型增 `templateId?: string`。
2. `const templateId = request.body?.templateId?.trim()`；`const template = templateId ? getTemplate(templateId) : null`；`if (templateId && !template) return reply.code(400).send({ error: 'template not found' })`。
3. 创建会话成功后、响应前，若 template：逐个绑定技能包（复用 skills 绑定的 audit 语义——直接循环 `recordAudit(pool, { actorId: userId, action: 'session.skill_bound', target: session.id, detail: { skillId } })`），响应 `{ session, template }`（无 template 时 `{ session }` 保持兼容）。

具体代码（读现状后按现有结构插入）：

```ts
      const templateId = request.body?.templateId?.trim()
      const template = templateId ? getTemplate(templateId) : null
      if (templateId && !template) {
        return reply.code(400).send({ error: 'template not found' })
      }
```
（放 memberIds/跨租户校验附近；创建成功后）：
```ts
      if (template) {
        for (const skillId of template.skillIds) {
          void recordAudit(pool, {
            actorId: userId,
            action: 'session.skill_bound',
            target: session.id,
            detail: { skillId },
          }).catch((err) => console.error('[audit] skill bind failed:', err))
        }
      }
      return reply.code(201).send(template ? { session: { ...session, templateId }, template } : { session })
```

（import 增 getTemplate from '../repos/templates.js' 与 recordAudit from '../repos/audit.js'——先核对现有 import。）

- [x] **Step 2: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；全量 gateway 测试全 PASS（195 用例——既有创建不带 templateId，行为不变）。

- [x] **Step 3: 提交**

```bash
git add services/gateway/src/routes/sessions.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(template): 会话创建套用模板（绑定技能包 + audit）"
```

---

## Task 3: 测试 + README + 验收 + 推送

**Files:**
- Create: `services/gateway/src/routes/templates.test.ts`
- Modify: `README.md`

- [x] **Step 1: templates.test.ts**

创建 `services/gateway/src/routes/templates.test.ts`（复用既有路由测试风格）：

```ts
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
```

- [x] **Step 2: README 追加「项目模板」节**

在 README「### 多租户隔离（M3.3 / FR-ORG-01 / FR-SEC-02）」节之后追加：

```markdown
### 行业项目模板（M3.1 / FR-ORG-05）

项目模板 = `services/gateway/templates/<id>.json` manifest（id/name/description/skillIds，热加载）：`GET /api/v1/templates` 列表；新建项目会话带 `templateId` 一键套用（自动绑定模板技能包，audit 留痕）。审批流模板/角色权限模板为 manifest 预留字段（Phase 3 后续消费）。初始模板：软件交付（pm+fullstack）、需求管理（pm）。
```

- [x] **Step 3: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
```

Expected: build 全过；test 全绿（contracts 2 + gateway 195+3≈198 + web 34 ≈ 234）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净。

- [x] **Step 4: 真实验收**

```bash
cd /tmp
# 1) 登录 → GET /api/v1/templates（含 software-delivery/requirements-mgmt）
# 2) 创建会话带 templateId=software-delivery → 201 响应含 template + session.templateId
# 3) audit 查 session.skill_bound 2 条（pm + fullstack）
# 4) 未知 templateId → 400
```

- [x] **Step 5: 提交 + 推送**

```bash
git add README.md services/gateway/src/routes/templates.test.ts docs/superpowers/plans/2026-08-15-phase3-plan5-template.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 23 全部勾选 + README 项目模板说明"
git push
```

Expected: 推送成功（CI 应绿）。

---

## Self-Review 记录

- **Spec 覆盖**：FR-ORG-05（项目模板：预设规范，新建一键套用）→ manifest + 会话创建套用技能包；「审批节点/角色/群结构自动生成」→ manifest 预留 approvalFlow/roles 字段（Phase 3 后续消费，本计划 MVP 聚焦技能包预设）；BL-1 项目模板能力。
- **占位符扫描**：无 TBD；文件逐字给出。
- **类型一致性**：`ProjectTemplate`（id/name/description/skillIds/approvalFlow?/roles?）在契约/manifest/repos/路由/测试一致；templateId 在会话创建 Body/响应一致。
- **已知取舍**：模板 MVP 只套用技能包（审批流/角色模板记后续）；模板热加载（与 skills 同）；无 DB 表（文件即真源）；初始 2 模板（扩充记后续）；前端模板选择器记后续（本计划 API 层）。
