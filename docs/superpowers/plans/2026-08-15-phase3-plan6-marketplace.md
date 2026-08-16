# Phase 3 · 计划 24：技能包市场 MVP（M3.1 / FR-ECO-01）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地技能包市场 MVP（M3.1/FR-ECO-01，P2/BL-3）：第三方技能包浏览（`GET /api/v1/marketplace/skills`，公开列表）+ 安装（`POST /api/v1/marketplace/skills/:id/install`，管理员一键安装到本地 `skills/` 目录热加载生效）。分成/沙箱白名单记 Phase 3 后续。

**Architecture:** 新增 `services/gateway/marketplace/` 目录放第三方技能包 manifest（与本地 `skills/` 隔离，模拟市场远端；文件即真源，热加载=重读）→ `repos/marketplace.ts`（listMarketplaceSkills/getMarketplaceSkill + installSkill——从 marketplace 拷贝到 skills 目录）→ 路由 `routes/marketplace.ts`（GET 公开列表 + POST :id/install adminOnly + audit `marketplace.installed`）。安装安全：技能包 id 白名单正则 `^[a-z0-9-]+$`（防路径穿越），目标路径 `skills/<id>.json`，重名覆盖需 `force` 参数或 409。

**Tech Stack:** 无新依赖。Node fs（目录列举/拷贝）+ Fastify。

**决策记录：** 市场 MVP 用「目录即市场」模型（marketplace/ 放 manifest 即上架——无独立上架端点，文件放置即发布；上架 API/审计记后续）；安装 = 文件拷贝到本地 skills（热加载生效，与 skills 系统同模式）；安装权限 adminOnly（PR-3：安装=执行变更）；路径安全：id 白名单正则防穿越，目标固定 skills/<id>.json；重名（本地已有同 id）→ 409「已存在，如需覆盖传 force」（force 参数 adminOnly 覆盖）；分成/沙箱白名单/签名校验记 Phase 3 后续（安全工程）；市场初始 1 个示例第三方技能包（qa-review：测试与验收审查）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `packages/contracts/src/index.ts` | 修改 | MarketplaceSkill 类型 |
| `services/gateway/marketplace/qa-review.json` | 创建 | 示例第三方技能包 |
| `services/gateway/src/repos/marketplace.ts` | 创建 | 市场浏览 + 安装（fs 拷贝） |
| `services/gateway/src/routes/marketplace.ts` | 创建 | GET 列表 + POST 安装 |
| `services/gateway/src/routes/marketplace.test.ts` | 创建 | 浏览/安装/路径安全测试 |
| `services/gateway/src/server.ts` | 修改 | 注册市场路由 |
| `README.md` | 修改 | 技能包市场说明 |

---

## Task 1: 契约 + 市场目录 + 浏览路由

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `services/gateway/marketplace/qa-review.json`
- Create: `services/gateway/src/repos/marketplace.ts`
- Create: `services/gateway/src/routes/marketplace.ts`
- Modify: `services/gateway/src/server.ts`

- [ ] **Step 1: 契约**

读 `packages/contracts/src/index.ts`，文件末尾（ProjectTemplate 之后）追加：

```ts
export interface MarketplaceSkill {
  id: string
  name: string
  description: string
  /** 工具白名单（声明式；沙箱强制记 Phase 3 后续） */
  toolAllowlist: string[]
  /** 是否已安装到本地 */
  installed: boolean
}
```

- [ ] **Step 2: 示例第三方技能包**

创建 `services/gateway/marketplace/qa-review.json`：

```json
{
  "id": "qa-review",
  "name": "质量审查",
  "description": "第三方技能包：代码质量与测试审查（社区贡献）",
  "toolAllowlist": ["read", "grep", "glob", "bash"]
}
```

- [ ] **Step 3: repos/marketplace.ts**

创建 `services/gateway/src/repos/marketplace.ts`：

```ts
import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MarketplaceSkill } from '@ta/contracts'

const MARKETPLACE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../marketplace')
const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../skills')

/** 技能包 id 白名单（防路径穿越） */
const SKILL_ID_RE = /^[a-z0-9-]{1,64}$/

interface SkillManifest {
  id: string
  name: string
  description: string
  toolAllowlist: string[]
}

function readManifest(file: string): SkillManifest | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SkillManifest
  } catch (err) {
    console.error(`[marketplace] failed to load ${file}:`, err)
    return null
  }
}

/** 市场技能包列表（含已安装标记） */
export function listMarketplaceSkills(): MarketplaceSkill[] {
  const files = readdirSync(MARKETPLACE_DIR).filter((f) => f.endsWith('.json'))
  const skills: MarketplaceSkill[] = []
  for (const f of files) {
    const manifest = readManifest(path.join(MARKETPLACE_DIR, f))
    if (!manifest || !SKILL_ID_RE.test(manifest.id)) continue
    skills.push({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      toolAllowlist: manifest.toolAllowlist,
      installed: existsSync(path.join(SKILLS_DIR, `${manifest.id}.json`)),
    })
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id))
}

export function getMarketplaceSkill(id: string): MarketplaceSkill | null {
  return listMarketplaceSkills().find((s) => s.id === id) ?? null
}

/** 安装市场技能包到本地（覆盖需 force）；返回是否覆盖 */
export function installSkill(id: string, force: boolean): { installed: boolean; overwritten: boolean } {
  if (!SKILL_ID_RE.test(id)) throw new Error('invalid skill id')
  const source = path.join(MARKETPLACE_DIR, `${id}.json`)
  if (!existsSync(source)) throw new Error('skill not found in marketplace')
  const target = path.join(SKILLS_DIR, `${id}.json`)
  const overwritten = existsSync(target)
  if (overwritten && !force) throw new Error('skill already installed (use force to overwrite)')
  copyFileSync(source, target)
  return { installed: true, overwritten }
}
```

- [ ] **Step 4: routes/marketplace.ts**

创建 `services/gateway/src/routes/marketplace.ts`：

```ts
import type { FastifyInstance } from 'fastify'
import { requireAuth, requireRoleFor } from '../middleware.js'
import { getMarketplaceSkill, installSkill, listMarketplaceSkills } from '../repos/marketplace.js'
import { recordAudit } from '../repos/audit.js'
import type { Config } from '../config.js'
import pg from 'pg'

export function registerMarketplaceRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const auth = requireAuth(config, pool)
  const adminOnly = requireRoleFor(config, pool)

  // 市场浏览（登录可见）
  app.get('/api/v1/marketplace/skills', { preHandler: auth }, async () => {
    return { skills: listMarketplaceSkills() }
  })

  // 安装（管理员；路径白名单 + 重名保护 + 审计）
  app.post<{ Params: { id: string }; Body: { force?: boolean } }>(
    '/api/v1/marketplace/skills/:id/install',
    { preHandler: adminOnly },
    async (request, reply) => {
      const id = request.params.id
      if (!/^[a-z0-9-]{1,64}$/.test(id)) {
        return reply.code(400).send({ error: 'invalid skill id' })
      }
      const skill = getMarketplaceSkill(id)
      if (!skill) return reply.code(404).send({ error: 'skill not found in marketplace' })
      try {
        const result = installSkill(id, request.body?.force === true)
        void recordAudit(pool, {
          actorId: request.user!.id,
          action: 'marketplace.installed',
          target: id,
          detail: { overwritten: result.overwritten },
        }).catch((err) => console.error('[audit] install failed:', err))
        return { installed: true, overwritten: result.overwritten, skill }
      } catch (err) {
        if (err instanceof Error && err.message.includes('already installed')) {
          return reply.code(409).send({ error: err.message })
        }
        throw err
      }
    },
  )
}
```

- [ ] **Step 5: server.ts 注册**

读 `services/gateway/src/server.ts`，在 `registerTemplateRoutes(app, config, pool)` 之后增：

```ts
  registerMarketplaceRoutes(app, config, pool)
```

（import 增 `registerMarketplaceRoutes`。）

- [ ] **Step 6: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway typecheck
```

Expected: typecheck exit 0。

- [ ] **Step 7: 提交**

```bash
git add packages/contracts services/gateway/marketplace services/gateway/src/repos/marketplace.ts services/gateway/src/routes/marketplace.ts services/gateway/src/server.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(marketplace): 技能包市场浏览 + 安装仓储/路由"
```

---

## Task 2: 测试 + README + 验收 + 推送

**Files:**
- Create: `services/gateway/src/routes/marketplace.test.ts`
- Modify: `README.md`

- [ ] **Step 1: marketplace.test.ts**

创建 `services/gateway/src/routes/marketplace.test.ts`（复用既有路由测试风格）：

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../skills')

describe('marketplace routes', () => {
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
    // 清理测试安装（避免污染 skills 目录）
    const target = path.join(SKILLS_DIR, 'qa-review.json')
    if (existsSync(target)) unlinkSync(target)
  })

  async function loginAs(username: string): Promise<string> {
    const res = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username } })
    return res.json().token as string
  }

  it('lists marketplace skills (not installed initially)', async () => {
    const alice = await loginAs('alice')
    const res = await built.app.inject({ method: 'GET', url: '/api/v1/marketplace/skills', headers: { authorization: `Bearer ${alice}` } })
    expect(res.statusCode).toBe(200)
    const qa = (res.json().skills as Array<{ id: string; installed: boolean }>).find((s) => s.id === 'qa-review')
    expect(qa).toBeTruthy()
    expect(qa!.installed).toBe(false)
  })

  it('installs a marketplace skill (admin) and lists it as installed', async () => {
    const admin = await loginAs('alice') // 首用户 admin
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/marketplace/skills/qa-review/install',
      headers: { authorization: `Bearer ${admin}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().installed).toBe(true)
    expect(existsSync(path.join(SKILLS_DIR, 'qa-review.json'))).toBe(true)
    // 再装 → 409（无 force）
    const dup = await built.app.inject({
      method: 'POST',
      url: '/api/v1/marketplace/skills/qa-review/install',
      headers: { authorization: `Bearer ${admin}` },
    })
    expect(dup.statusCode).toBe(409)
    // force 覆盖 → 200
    const forced = await built.app.inject({
      method: 'POST',
      url: '/api/v1/marketplace/skills/qa-review/install',
      headers: { authorization: `Bearer ${admin}` },
      payload: { force: true },
    })
    expect(forced.statusCode).toBe(200)
    expect(forced.json().overwritten).toBe(true)
    // 列表标记 installed
    const list = await built.app.inject({ method: 'GET', url: '/api/v1/marketplace/skills', headers: { authorization: `Bearer ${admin}` } })
    const qa = (list.json().skills as Array<{ id: string; installed: boolean }>).find((s) => s.id === 'qa-review')
    expect(qa!.installed).toBe(true)
  })

  it('rejects non-admin install and path traversal ids', async () => {
    const alice = await loginAs('alice')
    const bob = await loginAs('bob')
    // 非 admin → 403
    const denied = await built.app.inject({ method: 'POST', url: '/api/v1/marketplace/skills/qa-review/install', headers: { authorization: `Bearer ${bob}` } })
    expect(denied.statusCode).toBe(403)
    // 路径穿越 → 400（白名单正则拒绝）
    const traversal = await built.app.inject({ method: 'POST', url: '/api/v1/marketplace/skills/..%2F..%2Fetc%2Fpasswd/install', headers: { authorization: `Bearer ${alice}` } })
    expect(traversal.statusCode).toBe(400)
  })
})
```

> 注：测试直接读写 `skills/` 目录（qa-review.json 安装/清理）——与网关测试并发跑无冲突（vitest fileParallelism false 已配）；清理在 afterEach 保证 skills 目录恢复原状。安装的 qa-review.json 在 afterEach 删除，不污染 skills 系统（GET /api/v1/skills 的既有测试不受影响——但若 marketplace.test.ts 与 skills.test.ts 并行跑会互见——`fileParallelism: false` 已配置避免）。

- [ ] **Step 2: README 追加「技能包市场」节**

在 README「### 行业项目模板（M3.1 / FR-ORG-05）」节之后追加：

```markdown
### 技能包市场（M3.1 / FR-ECO-01）

市场 = `services/gateway/marketplace/` 目录（第三方技能包 manifest，热加载）：`GET /api/v1/marketplace/skills` 浏览（含已安装标记）；管理员 `POST /api/v1/marketplace/skills/<id>/install` 一键安装到本地 `skills/`（重名需 `{force:true}` 覆盖；id 白名单防路径穿越；audit 留痕）。分成/沙箱白名单记后续。
```

- [ ] **Step 3: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
```

Expected: build 全过；test 全绿（contracts 2 + gateway 198+3≈201 + web 34 ≈ 237）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净（除 README/计划文档/测试安装的临时文件——afterEach 已清理）。

- [ ] **Step 4: 真实验收**

```bash
cd /tmp
# 1) 登录 → GET /marketplace/skills（qa-review installed=false）
# 2) admin POST /marketplace/skills/qa-review/install → 200 + skills/qa-review.json 存在
# 3) GET /api/v1/skills → 含 qa-review（热加载生效）
# 4) 重复安装 → 409；force → 200 overwritten
# 5) 非 admin → 403；路径穿越 id → 400
# 6) 清理：rm skills/qa-review.json（或保留——真实安装可保留，验证热加载）
```

- [ ] **Step 5: 提交 + 推送**

```bash
git add README.md services/gateway/src/routes/marketplace.test.ts docs/superpowers/plans/2026-08-15-phase3-plan6-marketplace.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 24 全部勾选 + README 技能包市场说明"
git push
```

Expected: 推送成功（CI 应绿）。

---

## Self-Review 记录

- **Spec 覆盖**：FR-ECO-01（第三方技能包上架/分发/分成；沙箱白名单）→ 市场目录浏览 + 安装分发（上架=文件放置；分成/沙箱记 Phase 3 后续）；BL-3 交付能力延伸。FR-ECO-02 行业模板库已由计划 23 交付。
- **占位符扫描**：无 TBD；代码逐字给出。
- **类型一致性**：`MarketplaceSkill`（id/name/description/toolAllowlist/installed）在契约/manifest 映射/repos/路由/测试一致；installSkill 返回 `{ installed, overwritten }` 在 repos/路由一致。
- **已知取舍**：目录即市场（无上架 API/审计，文件放置即发布）；安装 = fs 拷贝（无版本/签名校验，记后续）；分成/沙箱白名单/签名记 Phase 3 后续；force 覆盖需显式；id 白名单防穿越。
