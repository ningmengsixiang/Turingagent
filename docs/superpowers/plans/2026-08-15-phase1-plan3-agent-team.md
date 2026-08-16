# Phase 1 · 计划 3：智能体四角色（M1.4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把单一 Ta-Fullstack 智能体扩展为 PRD 定义的四角色团队：**Ta-PM**（需求澄清/基线）、**Ta-Architect**（评审/影响评估）、**Ta-Fullstack**（写码交付）、**Ta-QA**（测试/验收），在会话内 `@Ta-PM <需求>` / `@Ta-Architect …` / `@Ta-Fullstack …` / `@Ta-QA …` 分别触发对应角色的 persona 回复。

**Architecture:** 智能体定义注册表（`src/agent/registry.ts`：id/显示名/提及模式/persona 引用）+ 四个 persona 文件 + `AgentBridge` 重构（按提及路由到对应智能体，回复以对应 `agent-<role>` 身份落库）+ 前端 senderId → 显示名映射（AI 徽标保留）。

**Tech Stack:** 既有（Node/fetch/React）；无新依赖；persona 镜像自 preset 人设结构（Ta-Fullstack 已有，其余三个按 PRD 角色定义撰写）。

**决策记录：** 智能体用户 id 约定 `agent-ta-pm` / `agent-ta-architect` / `agent-ta-fullstack` / `agent-ta-qa`（PRD 命名，前端按 id 映射显示名）；提及正则统一 `/@\s*Ta[-_]?(PM|Architect|Fullstack|QA)/i`（不带 /g，防 lastIndex 泄漏）；同一消息多 @ 只路由第一个匹配的智能体；回复仍以 human 审批闸门为前提（agent 只建议）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/src/agent/registry.ts` | 创建 | AgentDefinition 注册表（id/name/mention/persona） |
| `services/gateway/src/agent/persona-ta-pm.ts` | 创建 | Ta-PM persona（澄清/基线/流程推进） |
| `services/gateway/src/agent/persona-ta-architect.ts` | 创建 | Ta-Architect persona（评审/影响评估） |
| `services/gateway/src/agent/persona-ta-qa.ts` | 创建 | Ta-QA persona（测试/验收） |
| `services/gateway/src/agent/persona-ta-fullstack.ts` | 修改 | 原文件保持，注册表引用 |
| `services/gateway/src/agent/bridge.ts` | 修改 | 提及路由 → 对应 agent 的 persona/身份回写 |
| `services/gateway/src/agent/bridge.test.ts` | 修改 | 四角色路由测试 |
| `apps/web/src/pages/Chat.tsx` | 修改 | senderId → 显示名映射（四角色 + AI 徽标） |
| `apps/web/src/pages/Chat.test.tsx` | 修改 | 多角色显示名用例 |
| `README.md` | 修改 | 四角色触发说明 |

---

## Task 1: 智能体注册表 + 三个新 persona

**Files:**
- Create: `services/gateway/src/agent/registry.ts`
- Create: `services/gateway/src/agent/persona-ta-pm.ts`
- Create: `services/gateway/src/agent/persona-ta-architect.ts`
- Create: `services/gateway/src/agent/persona-ta-qa.ts`
- Create: `services/gateway/src/agent/registry.test.ts`

- [ ] **Step 1: 写 persona-ta-pm.ts**

```ts
/**
 * Ta-PM persona：需求澄清与流程推进（PRD Ta-PM 角色）。
 */
export const TA_PM_PERSONA = `你是 Ta-PM，Turing Agent 的「需求经理智能体」。你的使命：把模糊的业务想法引导成清晰、可验收的需求基线。

## 身份与边界（硬约束）
- 你是 AI 智能体，回复明确以 AI 身份输出。
- 人类审批闸门：你只建议、不决策；审批节点必须由人类完成。
- 克制发言：只在与需求相关时发言，不闲聊。

## 职责
1. 需求识别：30 秒内响应 @ 需求，复述并生成「需求草稿」要点。
2. 澄清引导：一轮精简提问（≤5 问，封闭式为主，每题带默认建议）；答「按默认」即采用。
3. 基线输出：把确认结果整理为需求基线要点（范围 / 用户 / 验收标准 / 假设）。
4. 流程推进：识别分歧点并建议 @ 相关人确认；提醒变更走审批。

## 输出规范
- 简洁、结构化（要点列表）；不写代码；需求不明确时列出缺失信息请用户补充，不臆造业务规则。`
```

- [ ] **Step 2: 写 persona-ta-architect.ts**

```ts
/**
 * Ta-Architect persona：技术评审与影响评估（PRD Ta-Architect 角色）。
 */
export const TA_ARCHITECT_PERSONA = `你是 Ta-Architect，Turing Agent 的「架构师智能体」。你的使命：对需求/变更做技术影响评估，给出架构意见。

## 身份与边界（硬约束）
- 你是 AI 智能体，回复明确以 AI 身份输出。
- 人类审批闸门：你只建议、不决策；上线类动作必须人类确认。
- 克制发言：只在被 @ 或评审节点发言。

## 职责
1. 影响评估：评估变更对数据模型、接口、模块的影响范围。
2. 方案建议：给出 1-2 个可选技术方案与取舍（复杂度/风险/工期）。
3. 评审意见：对设计稿/方案给出结构化评审意见（通过 / 需修改 / 拒绝 + 理由）。
4. 成本提示：标注实现成本等级（低/中/高）与主要风险点。

## 输出规范
- 结构化（影响范围 / 方案 / 风险 / 成本）；不写完整代码；涉及数据结构变更时明确列出。`
```

- [ ] **Step 3: 写 persona-ta-qa.ts**

```ts
/**
 * Ta-QA persona：测试与验收（PRD Ta-QA 角色）。
 */
export const TA_QA_PERSONA = `你是 Ta-QA，Turing Agent 的「测试智能体」。你的使命：验证交付物质量，输出可执行验收结果。

## 身份与边界（硬约束）
- 你是 AI 智能体，回复明确以 AI 身份输出。
- 人类审批闸门：你只建议、不决策；最终验收由人类确认。
- 克制发言：只在测试/验收节点发言。

## 职责
1. 测试计划：按需求基线列出测试用例（功能 / 边界 / 异常）。
2. 缺陷报告：发现问题按严重度分级（阻塞 / 高 / 中 / 低）并给出复现步骤。
3. 验收清单：对照验收标准逐项给出 通过 / 不通过 / 待确认。
4. 回归确认：修复后复验，输出结论。

## 输出规范
- 结构化（用例清单 / 缺陷分级 / 验收勾选）；不臆造测试结果，未验证的明确标注。`
```

- [ ] **Step 4: 写 registry.ts**

```ts
import { TA_PM_PERSONA } from './persona-ta-pm.js'
import { TA_ARCHITECT_PERSONA } from './persona-ta-architect.js'
import { TA_FULLSTACK_PERSONA } from './persona-ta-fullstack.js'
import { TA_QA_PERSONA } from './persona-ta-qa.js'

export interface AgentDefinition {
  id: string
  displayName: string
  /** 提及匹配：从消息中提取 agent 身份（含大小写/连字符变体） */
  mentionPattern: RegExp
  persona: string
  description: string
}

export const AGENTS: AgentDefinition[] = [
  {
    id: 'agent-ta-pm',
    displayName: 'Ta-PM',
    mentionPattern: /@\s*Ta[-_]?PM(?![\w-])/i,
    persona: TA_PM_PERSONA,
    description: '需求澄清与流程推进',
  },
  {
    id: 'agent-ta-architect',
    displayName: 'Ta-Architect',
    mentionPattern: /@\s*Ta[-_]?Architect(?![\w-])/i,
    persona: TA_ARCHITECT_PERSONA,
    description: '技术评审与影响评估',
  },
  {
    id: 'agent-ta-fullstack',
    displayName: 'Ta-Fullstack',
    mentionPattern: /@\s*Ta[-_]?Fullstack(?![\w-])/i,
    persona: TA_FULLSTACK_PERSONA,
    description: '软件生成与交付',
  },
  {
    id: 'agent-ta-qa',
    displayName: 'Ta-QA',
    mentionPattern: /@\s*Ta[-_]?QA(?![\w-])/i,
    persona: TA_QA_PERSONA,
    description: '测试与验收',
  },
]

export function findAgentByMention(content: string): { agent: AgentDefinition; requirement: string } | null {
  // 按注册顺序匹配第一个提及（无 /g，无 lastIndex 泄漏）
  for (const agent of AGENTS) {
    const match = agent.mentionPattern.exec(content)
    if (match) {
      const requirement = content.slice(match.index + match[0].length).trim()
      if (requirement.length === 0) return null // 空提及视为无需求（保持旧语义）
      return { agent, requirement }
    }
  }
  return null
}

/** 前端显示名映射（senderId → displayName） */
export const AGENT_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a.displayName]),
)
```

> 注：`findAgentByMention` 按注册顺序取第一个匹配（PM 先于 Architect/Fullstack/QA——`@Ta-Fullstack` 不会被 `Ta-PM` 误匹配，各正则互斥）。要求文本 = @ 提及之后的全部内容。

- [ ] **Step 5: 写 registry.test.ts**

```ts
import { describe, expect, it } from 'vitest'
import { AGENTS, findAgentByMention, AGENT_DISPLAY_NAMES } from './registry.js'

describe('agent registry', () => {
  it('has four agents with distinct ids and patterns', () => {
    expect(AGENTS).toHaveLength(4)
    expect(new Set(AGENTS.map((a) => a.id)).size).toBe(4)
    for (const agent of AGENTS) {
      expect(agent.mentionPattern.flags).not.toContain('g') // 无 lastIndex 泄漏
      expect(agent.persona.length).toBeGreaterThan(50)
    }
  })

  it('routes mentions to the matching agent', () => {
    expect(findAgentByMention('@Ta-PM 帮我澄清报销需求')?.agent.id).toBe('agent-ta-pm')
    expect(findAgentByMention('@Ta-Architect 评估这个变更')?.agent.id).toBe('agent-ta-architect')
    expect(findAgentByMention('@Ta-Fullstack 实现报销系统')?.agent.id).toBe('agent-ta-fullstack')
    expect(findAgentByMention('@Ta-QA 验收一下')?.agent.id).toBe('agent-ta-qa')
  })

  it('extracts the requirement after the mention', () => {
    const hit = findAgentByMention('@Ta-QA 帮我验收这个功能')
    expect(hit?.requirement).toBe('帮我验收这个功能')
  })

  it('returns null without a mention', () => {
    expect(findAgentByMention('今天天气不错')).toBeNull()
  })

  it('maps agent ids to display names', () => {
    expect(AGENT_DISPLAY_NAMES['agent-ta-fullstack']).toBe('Ta-Fullstack')
    expect(AGENT_DISPLAY_NAMES['agent-ta-pm']).toBe('Ta-PM')
  })
})
```

- [ ] **Step 6: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；新增 registry.test 5 用例全 PASS；既有用例不回归。

- [ ] **Step 7: 提交**

```bash
git add services/gateway
git commit -m "feat(agent): 四角色注册表 + Ta-PM/Architect/QA persona"
```

---

## Task 2: AgentBridge 按角色路由

**Files:**
- Modify: `services/gateway/src/agent/bridge.ts`
- Modify: `services/gateway/src/agent/bridge.test.ts`

- [ ] **Step 1: 重写 bridge.ts**

```ts
import type { Message } from '@ta/contracts'
import { randomUUID } from 'node:crypto'
import type { Config } from '../config.js'
import type { ModelProvider } from '../model/provider.js'
import { createMessage } from '../repos/messages.js'
import { findAgentByMention, AGENT_DISPLAY_NAMES } from './registry.js'
import type pg from 'pg'

export interface AgentBridgeOptions {
  pool: pg.Pool
  config: Config
  provider: ModelProvider
  emitMessageCreated: (message: Message) => void
}

export interface MentionResult {
  triggered: boolean
  agentId?: string
  reply?: Message
  skippedReason?: 'not-a-mention' | 'agent-message' | 'disabled' | 'too-long' | 'error'
}

export class AgentBridge {
  constructor(private readonly options: AgentBridgeOptions) {}

  async handle(message: Message): Promise<MentionResult> {
    if (message.senderKind === 'agent') return { triggered: false, skippedReason: 'agent-message' }
    if (!this.options.config.agentEnabled) return { triggered: false, skippedReason: 'disabled' }

    const hit = findAgentByMention(message.content)
    if (!hit) return { triggered: false, skippedReason: 'not-a-mention' }
    if (hit.requirement.length > this.options.config.agentMaxPromptChars) {
      return { triggered: false, skippedReason: 'too-long' }
    }

    const { agent, requirement } = hit
    const systemPrompt = agent.persona.replaceAll('{{cwd}}', process.cwd())
    try {
      const completion = await this.options.provider.complete(systemPrompt, requirement)
      console.log(
        `[agent] ${agent.displayName} run: prompt=${completion.promptTokens} completion=${completion.completionTokens} tokens`,
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
}
```

> 注：`AGENT_USER_ID`/`AGENT_DISPLAY_NAME` 常量删除（由注册表取代）；错误回复用对应 agent 显示名。

- [ ] **Step 2: 重写 bridge.test.ts（保留原 7 用例语义 + 四角色路由）**

关键改动：
1. import：删 `AGENT_USER_ID`，改从 registry 导入 `AGENTS`（或直接引用 `'agent-ta-fullstack'` 字符串——以既有测试断言为准）。
2. 原「triggers on @Ta-Fullstack」用例改为断言 `result.agentId === 'agent-ta-fullstack'` 且回复 senderId 为该 id。
3. 新增「routes to the mentioned agent」用例：`@Ta-PM …` → agentId agent-ta-pm、`@Ta-Architect …` → agent-ta-architect、`@Ta-QA …` → agent-ta-qa（各断言 provider.calls 的 systemPrompt 含对应 persona 片段，如「需求经理智能体」「架构师智能体」「测试智能体」）。
4. 其余用例（non-mention / agent-message / disabled / too-long / error / 连续触发）保持，断言改用 `agentId` 字段。

> 提示：persona 判断可用 `provider.calls[0]!.systemPrompt` 的 `toContain`——各 persona 有独特标识句（PM「需求经理智能体」、Architect「架构师智能体」、QA「测试智能体」、Fullstack「软件生成智能体」）。

- [ ] **Step 3: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；bridge 测试（原 7 改 + 新增路由用例）全 PASS；既有用例不回归。

- [ ] **Step 4: 提交**

```bash
git add services/gateway
git commit -m "feat(agent): 桥接按 @ 提及路由到四角色"
```

---

## Task 3: 前端多角色显示

**Files:**
- Modify: `apps/web/src/pages/Chat.tsx`
- Modify: `apps/web/src/pages/Chat.test.tsx`

- [ ] **Step 1: Chat.tsx 显示名映射**

1. 顶部定义（或在组件外）：

```tsx
const AGENT_NAMES: Record<string, string> = {
  'agent-ta-pm': 'Ta-PM',
  'agent-ta-architect': 'Ta-Architect',
  'agent-ta-fullstack': 'Ta-Fullstack',
  'agent-ta-qa': 'Ta-QA',
}
```

2. 消息渲染处：`<span className="bubble-name">{m.senderKind === 'agent' ? 'Ta-Fullstack' : m.senderId}</span>` 改为：

```tsx
                  <span className="bubble-name">
                    {m.senderKind === 'agent' ? (AGENT_NAMES[m.senderId] ?? 'AI 智能体') : m.senderId}
                  </span>
```

- [ ] **Step 2: Chat.test.tsx 补多角色显示名用例**

```tsx
  it('renders the display name for each agent role', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': {
        messages: [
          { id: 'm1', clientMsgId: 'c1', sessionId: 's1', senderId: 'agent-ta-pm', senderKind: 'agent', contentType: 'text', content: '需求已澄清', seq: 1, createdAt: '' },
          { id: 'm2', clientMsgId: 'c2', sessionId: 's1', senderId: 'agent-ta-qa', senderKind: 'agent', contentType: 'text', content: '测试通过', seq: 2, createdAt: '' },
        ],
      },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText('需求已澄清')).toBeTruthy()
    expect(screen.getByText('Ta-PM')).toBeTruthy()
    expect(screen.getByText('Ta-QA')).toBeTruthy()
  })
```

- [ ] **Step 3: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose
pnpm --filter @ta/web build
```

Expected: typecheck exit 0；web 测试 13 用例全 PASS；build 产出 dist/。

- [ ] **Step 4: 提交**

```bash
git add apps/web
git commit -m "feat(web): 四角色显示名映射"
```

---

## Task 4: 收尾（README + 全仓验收 + 推送）

**Files:**
- Modify: `README.md`（根）

- [ ] **Step 1: README 更新「智能体」节**

把「### 智能体（Ta-Fullstack）」节标题与说明改为四角色版本：

```markdown
### 智能体团队（四角色）

网关内置模型网关（DeepSeek，OpenAI 兼容）。会话内 @ 对应智能体即触发，回复以该智能体身份实时推回：

| 智能体 | 触发 | 职责 |
|---|---|---|
| Ta-PM | `@Ta-PM <需求>` | 需求澄清与基线 |
| Ta-Architect | `@Ta-Architect <变更>` | 技术评审与影响评估 |
| Ta-Fullstack | `@Ta-Fullstack <需求>` | 软件生成与交付 |
| Ta-QA | `@Ta-QA <功能>` | 测试与验收 |

```bash
export MODEL_API_KEY=<你的 DeepSeek key>
pnpm dev:gateway
# 会话内发：@Ta-PM 帮我澄清报销需求 → Ta-PM 的回复实时出现在会话里
```

> 未配置 `MODEL_API_KEY` 时智能体自动禁用。`MODEL_BASE_URL` / `MODEL_NAME`（默认 `deepseek-chat`）可覆盖。
```

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm build
pnpm test
pnpm install --frozen-lockfile
```

Expected: build 全过；test 全绿（contracts 2 + gateway ~90 + web 13 = ~105）；frozen-lockfile 通过；`git status` 干净（除 README）。

- [ ] **Step 3: 提交 + 推送**

```bash
git add README.md
git commit -m "docs: README 更新智能体四角色说明"
git push
```

Expected: 推送成功。

---

## Self-Review 记录（写完后自查）

- **Spec 覆盖**：PRD §1.3 四角色团队（Ta-PM/Ta-Architect/Ta-Fullstack/Ta-QA）→ 注册表 + persona；TechDesign §7.1 智能体设计 → 注册表结构；PR-2 身份透明 → 前端按 id 显示对应角色名 + AI 徽标。
- **占位符扫描**：无 TBD；bridge.test.ts 的改写范围已注明（保留原 7 用例语义 + 四角色路由）。
- **类型一致性**：`AgentDefinition`（id/displayName/mentionPattern/persona）在 registry/bridge/测试一致；`AGENT_DISPLAY_NAMES` 与前端 AGENT_NAMES 一致（双处声明，标注镜像关系）；`findAgentByMention` 返回 `{agent, requirement}` 在 bridge/测试一致。
- **已知取舍**：多 @ 只路由第一个；agent 不做会话成员（发送不经成员校验，回复 senderId 为 agent id）；persona 为镜像常量（生产化读 preset）；四角色共用一个模型（模型分层路由 Phase 2）。
