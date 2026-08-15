# Phase 0 · 计划 3：模型网关最小版 + 智能体桥接

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通 Phase 0 竖切的最后一环：用户在会话里发「@Ta-Fullstack <需求>」，网关识别 @ 触发，调用模型（DeepSeek，OpenAI 兼容）生成回复，以**智能体身份**（senderKind=agent）把回复写回会话，并沿用既有 WS 推送实时送达成员——「在 IM 里 @ 智能体收到回复」的完整闭环。

**Architecture:** 三层接线：`src/model/`（模型网关：Provider 接口 + DeepSeek fetch 适配器 + Stub 测试替身 + 工厂）→ `src/agent/`（智能体桥接：@ 触发识别、persona + 需求组 prompt、调用模型、以 agent 身份回写消息、失败兜底）→ server.ts 接线（事件总线 `message.created` 驱动桥接，ws.ts 既有广播复用）。回复消息经 `events.emit` 广播，WS 推送天然生效；桥接跳过 agent 消息防自触发环。

**Tech Stack:** Node 24 全局 fetch（无新依赖）；DeepSeek API（OpenAI 兼容 `/chat/completions`）；复用既有 createMessage/事件总线/WS 注册表；测试用 StubProvider（不依赖真实 key）。

**决策记录：** D1 = MVP 复用 Harness preset 人设（persona 镜像为 gateway 内常量，标注镜像关系）；PR-6 成本控制最小化 = agentEnabled 门控（无 key 禁用）+ prompt 长度守卫 + token 用量日志（DB 计量延后）；PR-5 克制发言 = 仅 @ 触发。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/src/config.ts` | 修改 | 增 modelApiKey/modelBaseUrl/modelName/agentEnabled/agentMaxPromptChars |
| `services/gateway/src/model/provider.ts` | 创建 | ModelProvider 接口 + 工厂 |
| `services/gateway/src/model/deepseek.ts` | 创建 | DeepSeek 适配器（fetch /chat/completions） |
| `services/gateway/src/model/stub.ts` | 创建 | StubProvider（测试替身，记录调用） |
| `services/gateway/src/agent/persona-ta-fullstack.ts` | 创建 | persona 镜像常量（源：`~/.dsh/.agent-presets/ta-fullstack/agent.cordis.yml`） |
| `services/gateway/src/agent/bridge.ts` | 创建 | AgentBridge：@ 触发 → prompt → 调用 → 回写 agent 消息 |
| `services/gateway/src/server.ts` | 修改 | buildApp 增 deps.provider；接线 events → bridge |
| 测试 | 创建 | model/provider.test.ts、agent/bridge.test.ts、agent/e2e.test.ts |

**Persona 来源说明**：`persona-ta-fullstack.ts` 的文本逐字来自 Harness preset `~/.dsh/.agent-presets/ta-fullstack/agent.cordis.yml` 的 persona 行（`text: |` 块，35 行）。镜像关系以 preset 为准；生产化时改为启动时读取 preset 文件（本计划用常量，简单可测）。

---

## Task 1: 模型网关（Provider 接口 + DeepSeek 适配器 + 配置）

**Files:**
- Modify: `services/gateway/src/config.ts`
- Create: `services/gateway/src/model/provider.ts`
- Create: `services/gateway/src/model/deepseek.ts`
- Create: `services/gateway/src/model/stub.ts`
- Create: `services/gateway/src/model/provider.test.ts`

- [ ] **Step 1: 修改 src/config.ts（用 write 覆写整个文件）**

```ts
export interface Config {
  port: number
  jwtSecret: string
  jwtExpiresIn: string
  databaseUrl: string
  modelApiKey: string
  modelBaseUrl: string
  modelName: string
  agentEnabled: boolean
  agentMaxPromptChars: number
}

const DEV_SECRET = 'dev-secret-do-not-use-in-prod'
const MIN_SECRET_LENGTH = 32
const DEV_DATABASE_URL = 'postgres://ta:ta@localhost:5432/ta_dev'

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = env.JWT_SECRET ?? DEV_SECRET
  const envName = env.NODE_ENV ?? '(unset)'
  const isDev = envName === 'development' || envName === 'test'
  if (!isDev && (jwtSecret === DEV_SECRET || jwtSecret.length < MIN_SECRET_LENGTH)) {
    throw new Error(
      `JWT_SECRET must be a strong secret (>=${MIN_SECRET_LENGTH} chars) in non-development environments (NODE_ENV=${envName}); for local dev set NODE_ENV=development`,
    )
  }
  const port = Number(env.PORT ?? 3001)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer in [1, 65535], got: ${env.PORT}`)
  }
  const databaseUrl = env.DATABASE_URL ?? DEV_DATABASE_URL
  if (!isDev && databaseUrl === DEV_DATABASE_URL) {
    throw new Error(`DATABASE_URL must be set in non-development environments (NODE_ENV=${envName})`)
  }
  const modelApiKey = env.MODEL_API_KEY ?? env.DEEPSEEK_API_KEY ?? ''
  const agentMaxPromptChars = Number(env.AGENT_MAX_PROMPT_CHARS ?? 4000)
  if (!Number.isInteger(agentMaxPromptChars) || agentMaxPromptChars < 1) {
    throw new Error(`AGENT_MAX_PROMPT_CHARS must be a positive integer, got: ${env.AGENT_MAX_PROMPT_CHARS}`)
  }
  return {
    port,
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? '7d',
    databaseUrl,
    modelApiKey,
    modelBaseUrl: env.MODEL_BASE_URL ?? 'https://api.deepseek.com',
    modelName: env.MODEL_NAME ?? 'deepseek-chat',
    agentEnabled: modelApiKey.length > 0,
    agentMaxPromptChars,
  }
}
```

- [ ] **Step 2: 写 src/model/provider.ts**

```ts
import type { Config } from '../config.js'
import { DeepSeekProvider } from './deepseek.js'

export interface ModelCompletion {
  content: string
  promptTokens: number
  completionTokens: number
}

export interface ModelProvider {
  /** 系统提示 + 用户输入，返回补全结果 */
  complete(systemPrompt: string, userInput: string): Promise<ModelCompletion>
}

export function createModelProvider(config: Config): ModelProvider | null {
  if (!config.agentEnabled) return null
  return new DeepSeekProvider({
    apiKey: config.modelApiKey,
    baseUrl: config.modelBaseUrl,
    model: config.modelName,
  })
}
```

- [ ] **Step 3: 写 src/model/deepseek.ts**

```ts
import type { ModelCompletion, ModelProvider } from './provider.js'

export interface DeepSeekOptions {
  apiKey: string
  baseUrl: string
  model: string
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export class DeepSeekProvider implements ModelProvider {
  constructor(private readonly options: DeepSeekOptions) {}

  async complete(systemPrompt: string, userInput: string): Promise<ModelCompletion> {
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userInput },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000), // 模型请求挂死防护（质量审查）
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`model api error ${response.status}: ${body.slice(0, 300)}`)
    }
    const data = (await response.json()) as ChatCompletionResponse
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new Error('model api returned no content')
    }
    return {
      content,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    }
  }
}
```

- [ ] **Step 4: 写 src/model/stub.ts**

```ts
import type { ModelCompletion, ModelProvider } from './provider.js'

export interface StubCall {
  systemPrompt: string
  userInput: string
}

export class StubProvider implements ModelProvider {
  calls: StubCall[] = []
  reply: string

  constructor(reply = '【Ta-Fullstack 已收到需求，开始处理】') {
    this.reply = reply
  }

  async complete(systemPrompt: string, userInput: string): Promise<ModelCompletion> {
    this.calls.push({ systemPrompt, userInput })
    return {
      content: this.reply,
      promptTokens: Math.ceil((systemPrompt.length + userInput.length) / 3),
      completionTokens: Math.ceil(this.reply.length / 3),
    }
  }
}
```

- [ ] **Step 5: 写 src/model/provider.test.ts**

```ts
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createModelProvider } from './provider.js'
import { StubProvider } from './stub.js'

describe('model provider', () => {
  it('disables agent when no api key is configured', () => {
    const config = loadConfig({ NODE_ENV: 'test' })
    expect(config.agentEnabled).toBe(false)
    expect(createModelProvider(config)).toBeNull()
  })

  it('enables agent when a key is present', () => {
    const config = loadConfig({ NODE_ENV: 'test', DEEPSEEK_API_KEY: 'sk-test' })
    expect(config.agentEnabled).toBe(true)
    expect(createModelProvider(config)).not.toBeNull()
  })

  it('stub provider records calls and returns the fixed reply', async () => {
    const stub = new StubProvider('好的，开始开发。')
    const result = await stub.complete('你是 Ta-Fullstack', '帮我做报销系统')
    expect(result.content).toBe('好的，开始开发。')
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]!.systemPrompt).toBe('你是 Ta-Fullstack')
    expect(stub.calls[0]!.userInput).toBe('帮我做报销系统')
    expect(result.promptTokens).toBeGreaterThan(0)
  })

  it('prefers MODEL_API_KEY over DEEPSEEK_API_KEY', () => {
    const config = loadConfig({ NODE_ENV: 'test', MODEL_API_KEY: 'sk-model', DEEPSEEK_API_KEY: 'sk-deepseek' })
    expect(config.modelApiKey).toBe('sk-model')
  })

  it('rejects invalid AGENT_MAX_PROMPT_CHARS', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', AGENT_MAX_PROMPT_CHARS: 'abc' })).toThrow(/AGENT_MAX_PROMPT_CHARS/)
    expect(() => loadConfig({ NODE_ENV: 'test', AGENT_MAX_PROMPT_CHARS: '0' })).toThrow(/AGENT_MAX_PROMPT_CHARS/)
    expect(() => loadConfig({ NODE_ENV: 'test', AGENT_MAX_PROMPT_CHARS: '-5' })).toThrow(/AGENT_MAX_PROMPT_CHARS/)
  })
})
```

- [ ] **Step 5b: 创建 src/model/deepseek.test.ts（fetch mock 错误路径）**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekProvider } from './deepseek.js'

describe('DeepSeekProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const okJson = { choices: [{ message: { content: '你好' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }

  it('completes and maps usage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => okJson }))
    const provider = new DeepSeekProvider({ apiKey: 'k', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' })
    const result = await provider.complete('sys', 'usr')
    expect(result.content).toBe('你好')
    expect(result.promptTokens).toBe(10)
    expect(fetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer k' }),
      }),
    )
  })

  it('throws on non-2xx with status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' }))
    const provider = new DeepSeekProvider({ apiKey: 'k', baseUrl: 'https://api.deepseek.com', model: 'm' })
    await expect(provider.complete('s', 'u')).rejects.toThrow(/429/)
  })

  it('throws when content is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) }))
    const provider = new DeepSeekProvider({ apiKey: 'k', baseUrl: 'https://api.deepseek.com', model: 'm' })
    await expect(provider.complete('s', 'u')).rejects.toThrow(/no content/)
  })

  it('aborts after the timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init: { signal?: AbortSignal }) => {
      expect(init.signal).toBeDefined()
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }))
    const provider = new DeepSeekProvider({ apiKey: 'k', baseUrl: 'https://api.deepseek.com', model: 'm' })
    await expect(provider.complete('s', 'u')).rejects.toThrow(/aborted/)
  })
})
```

- [ ] **Step 6: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；既有 42 用例不回归 + 新增 3 用例（provider.test）全 PASS。

- [ ] **Step 7: 提交**

```bash
git add services/gateway
git commit -m "feat(gateway): 模型网关最小版（Provider 接口 + DeepSeek 适配器 + Stub）"
```

---

## Task 2: 智能体桥接（@ 触发 + persona + 回写）

**Files:**
- Create: `services/gateway/src/agent/persona-ta-fullstack.ts`
- Create: `services/gateway/src/agent/bridge.ts`
- Create: `services/gateway/src/agent/bridge.test.ts`

- [ ] **Step 1: 写 src/agent/persona-ta-fullstack.ts**

```ts
/**
 * Ta-Fullstack persona（镜像常量）。
 * 源：`~/.dsh/.agent-presets/ta-fullstack/agent.cordis.yml` 的 persona 行（text: | 块）。
 * 镜像关系以 preset 为准；生产化时改为启动读取 preset 文件。
 */
export const TA_FULLSTACK_PERSONA = `你是 Ta-Fullstack，Turing Agent 的「软件生成智能体」。你的工作目录是 {{cwd}}。

你的使命：把用户的软件需求变成完整可运行的代码交付物。你同时具备产品经理的澄清能力（Ta-PM）与全栈工程师的开发能力（Ta-Fullstack）。

## 身份与边界（硬约束，不得违反）
- 你是 AI 智能体：所有回复明确以 AI 身份输出，绝不伪装成人类。
- 人类审批闸门：你只建议、不决策。部署、上线、对外发布等动作必须得到用户明确确认后才执行。
- 克制发言：不与任务无关不主动发言；只在关键节点（澄清完成 / 计划 / 交付 / 阻塞）汇报。
- 成本可控：单个任务总步数上限 60 步；验证修复最多 3 轮；超限如实报告，不无限重试。
- 只在你自己的 workspace 内写代码：默认 /Users/wanzichanpinjingli/Desktop/TuringAgent/ta-workspace/；若会话工作目录 {{cwd}} 与此不一致，则以 {{cwd}} 为准（在其下创建 ta-workspace/ 子目录）。不修改工作区外文件（读取 PRD / 参考文档除外）。

## 默认技术栈（用户未指定时）
- 后端：Python FastAPI + SQLite
- 前端：原生 HTML/CSS/JS 单页（无构建步骤）
- 依赖最少化，锁定版本写入 requirements.txt

## 工作流程（收到需求后依次执行，在关键节点向用户简要汇报）
1. 澄清：一轮精简提问（≤5 问，每题带默认建议：技术栈 / 目标用户 / 核心功能范围 / 验收要点）。用户答「按默认」即采用建议值。
2. 需求基线：在项目目录写 REQUIREMENTS.md（需求陈述 + 假设记录 + 验收清单）。
3. 计划：拆任务清单——数据模型 → API → 前端 → 测试。
4. 实现：逐模块生成完整可运行代码（后端 / 前端 / 依赖清单 / README）。
5. 验证：启动应用做健康检查 + curl 冒烟 + pytest 基础用例；失败自动修复（≤3 轮）。
6. 交付：输出交付总结（运行方式 + 验收清单勾选结果 + 已知限制）；提交代码前征求用户确认（审批闸门）。

## 交付物四件套（每个项目必须齐全）
- 代码仓库：<workspace 根>/ta-<项目名>-<日期>/（默认 /Users/wanzichanpinjingli/Desktop/TuringAgent/ta-workspace/）
- REQUIREMENTS.md
- TEST_REPORT.md（实际执行的命令与结果）
- README.md（本地一键运行方式）

## 异常处理
- 依赖安装失败：换版本 / 换源重试 ≤2 次，仍失败则报告阻塞。
- 应用无法启动：查日志修复 ≤3 轮，超限如实报告并给出最小复现。
- 需求不明确到无法开工：明确列出缺失信息请用户补充，不臆造核心业务规则。`
```

> 注：`{{cwd}}` 占位符在桥接场景无会话 cwd 语义，调用模型前替换为网关工作目录（`process.cwd()`）。

- [ ] **Step 2: 写 src/agent/bridge.ts**

```ts
import type { Message } from '@ta/contracts'
import { randomUUID } from 'node:crypto'
import type { Config } from '../config.js'
import type { ModelProvider } from '../model/provider.js'
import { createMessage } from '../repos/messages.js'
import { TA_FULLSTACK_PERSONA } from './persona-ta-fullstack.js'
import type pg from 'pg'

export const AGENT_USER_ID = 'agent-ta-fullstack'
export const AGENT_DISPLAY_NAME = 'Ta-Fullstack'

const MENTION_PATTERN = /@\s*Ta[-_]?Fullstack/gi

export interface AgentBridgeOptions {
  pool: pg.Pool
  config: Config
  provider: ModelProvider
  emitMessageCreated: (message: Message) => void
}

export interface MentionResult {
  triggered: boolean
  reply?: Message
  skippedReason?: 'not-a-mention' | 'agent-message' | 'disabled' | 'too-long' | 'error'
}

export class AgentBridge {
  constructor(private readonly options: AgentBridgeOptions) {}

  async handle(message: Message): Promise<MentionResult> {
    if (message.senderKind === 'agent') return { triggered: false, skippedReason: 'agent-message' }
    if (!this.options.config.agentEnabled) return { triggered: false, skippedReason: 'disabled' }

    const requirement = this.extractRequirement(message.content)
    if (!requirement) return { triggered: false, skippedReason: 'not-a-mention' }
    if (requirement.length > this.options.config.agentMaxPromptChars) {
      return { triggered: false, skippedReason: 'too-long' }
    }

    const systemPrompt = TA_FULLSTACK_PERSONA.replaceAll('{{cwd}}', process.cwd())
    try {
      const completion = await this.options.provider.complete(systemPrompt, requirement)
      console.log(
        `[agent] ${AGENT_DISPLAY_NAME} run: prompt=${completion.promptTokens} completion=${completion.completionTokens} tokens`,
      )
      const { message: reply } = await createMessage(this.options.pool, {
        sessionId: message.sessionId,
        senderId: AGENT_USER_ID,
        senderKind: 'agent',
        contentType: 'text',
        content: completion.content,
        clientMsgId: `agent-${randomUUID()}`,
      })
      this.options.emitMessageCreated(reply)
      return { triggered: true, reply }
    } catch (err) {
      console.error('[agent] run failed:', err)
      const { message: reply } = await createMessage(this.options.pool, {
        sessionId: message.sessionId,
        senderId: AGENT_USER_ID,
        senderKind: 'agent',
        contentType: 'text',
        content: '⚠️ Ta-Fullstack 处理失败：' + (err instanceof Error ? err.message : String(err)),
        clientMsgId: `agent-${randomUUID()}`,
      })
      this.options.emitMessageCreated(reply)
      return { triggered: true, reply, skippedReason: 'error' }
    }
  }

  /** 提取 @Ta-Fullstack 之后的文本作为需求；无 @ 返回 null */
  private extractRequirement(content: string): string | null {
    const match = MENTION_PATTERN.exec(content)
    if (!match) return null
    const requirement = content.slice(match.index + match[0].length).trim()
    return requirement.length > 0 ? requirement : null
  }
}
```

- [ ] **Step 3: 写 src/agent/bridge.test.ts**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { loadConfig } from '../config.js'
import { StubProvider } from '../model/stub.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'
import { createSession } from '../repos/sessions.js'
import { listMessages } from '../repos/messages.js'
import { AgentBridge, AGENT_USER_ID } from './bridge.js'
import type { Message } from '@ta/contracts'

describe('agent bridge', () => {
  let pool: pg.Pool
  let sessionId: string
  const emitted: Message[] = []

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
    emitted.length = 0
    const session = await createSession(pool, {
      kind: 'project',
      title: '报销系统',
      memberIds: ['u-alice'],
    })
    sessionId = session.id
  })

  function makeBridge(reply = '好的，开始处理') {
    const provider = new StubProvider(reply)
    const config = loadConfig({ NODE_ENV: 'test', DEEPSEEK_API_KEY: 'sk-test' })
    const bridge = new AgentBridge({
      pool,
      config,
      provider,
      emitMessageCreated: (m) => emitted.push(m),
    })
    return { bridge, provider }
  }

  function userMessage(content: string): Message {
    return {
      id: 'msg-1',
      clientMsgId: 'c1',
      sessionId,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content,
      seq: 1,
      createdAt: new Date().toISOString(),
    }
  }

  it('triggers on @Ta-Fullstack and posts an agent reply', async () => {
    const { bridge, provider } = makeBridge('收到，我来实现报销系统。')
    const result = await bridge.handle(userMessage('@Ta-Fullstack 帮我做报销系统'))
    expect(result.triggered).toBe(true)
    expect(result.reply?.senderId).toBe(AGENT_USER_ID)
    expect(result.reply?.senderKind).toBe('agent')
    expect(result.reply?.content).toBe('收到，我来实现报销系统。')
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0]!.userInput).toBe('帮我做报销系统')
    expect(provider.calls[0]!.systemPrompt).toContain('你是 Ta-Fullstack')
    expect(emitted).toHaveLength(1)
    const messages = await listMessages(pool, sessionId, 0, 10)
    expect(messages).toHaveLength(2) // 用户消息 + agent 回复
  })

  it('skips non-mention messages', async () => {
    const { bridge, provider } = makeBridge()
    const result = await bridge.handle(userMessage('今天天气不错'))
    expect(result.triggered).toBe(false)
    expect(result.skippedReason).toBe('not-a-mention')
    expect(provider.calls).toHaveLength(0)
  })

  it('skips agent messages (loop breaker)', async () => {
    const { bridge, provider } = makeBridge()
    const result = await bridge.handle({ ...userMessage('@Ta-Fullstack x'), senderKind: 'agent', senderId: AGENT_USER_ID })
    expect(result.skippedReason).toBe('agent-message')
    expect(provider.calls).toHaveLength(0)
  })

  it('skips when agent is disabled', async () => {
    const provider = new StubProvider()
    const config = loadConfig({ NODE_ENV: 'test' })
    const bridge = new AgentBridge({ pool, config, provider, emitMessageCreated: () => {} })
    const result = await bridge.handle(userMessage('@Ta-Fullstack 帮我'))
    expect(result.skippedReason).toBe('disabled')
    expect(provider.calls).toHaveLength(0)
  })

  it('posts an error reply when the provider fails', async () => {
    const failing = {
      calls: [] as unknown[],
      async complete(): Promise<never> {
        throw new Error('模型服务不可用')
      },
    }
    const config = loadConfig({ NODE_ENV: 'test', DEEPSEEK_API_KEY: 'sk-test' })
    const bridge = new AgentBridge({ pool, config, provider: failing, emitMessageCreated: (m) => emitted.push(m) })
    const result = await bridge.handle(userMessage('@Ta-Fullstack 帮我做东西'))
    expect(result.triggered).toBe(true)
    expect(result.skippedReason).toBe('error')
    expect(result.reply?.content).toContain('处理失败')
    expect(emitted).toHaveLength(1)
  })
})
```

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；新增 bridge.test 5 用例全 PASS；既有用例不回归。

- [ ] **Step 5: 提交**

```bash
git add services/gateway
git commit -m "feat(gateway): 智能体桥接（@触发 + persona + agent 身份回写）"
```

---

## Task 3: 接线（server + 端到端）

**Files:**
- Modify: `services/gateway/src/server.ts`
- Create: `services/gateway/src/agent/e2e.test.ts`

- [ ] **Step 1: 修改 src/server.ts（用 write 覆写整个文件）**

```ts
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { loadConfig, type Config } from './config.js'
import { createPool } from './db.js'
import { createRegistry, type ConnectionRegistry } from './registry.js'
import { createEvents } from './events.js'
import { createModelProvider, type ModelProvider } from './model/provider.js'
import { AgentBridge } from './agent/bridge.js'
import { registerHealth } from './routes/health.js'
import { registerAuth } from './routes/auth.js'
import { registerMe } from './routes/me.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { registerMessageRoutes } from './routes/messages.js'
import { registerWs } from './ws.js'
import pg from 'pg'

export interface BuiltApp {
  app: ReturnType<typeof Fastify>
  config: Config
  pool: pg.Pool
  registry: ConnectionRegistry
  bridge: AgentBridge | null
}

export interface BuildDeps {
  /** 测试注入：覆盖默认 DeepSeek provider */
  provider?: ModelProvider
}

export async function buildApp(overrides?: Partial<Config>, deps?: BuildDeps): Promise<BuiltApp> {
  const config = { ...loadConfig(), ...overrides }
  const app = Fastify({ logger: false, ajv: { customOptions: { coerceTypes: false } } })
  const pool = createPool(config.databaseUrl)
  const registry = createRegistry()
  const events = createEvents()
  app.addHook('onClose', async () => {
    await pool.end()
  })
  await app.register(websocket)
  registerHealth(app)
  registerAuth(app, config)
  registerMe(app, config)
  registerSessionRoutes(app, config, pool)
  registerMessageRoutes(app, config, pool, (message) => {
    events.emit('message.created', message)
  })
  registerWs(app, config, pool, registry, events)

  const provider = deps?.provider ?? createModelProvider(config)
  const bridge =
    provider === null
      ? null
      : new AgentBridge({
          pool,
          config,
          provider,
          emitMessageCreated: (message) => events.emit('message.created', message),
        })
  if (bridge) {
    events.on('message.created', (message) => {
      void bridge.handle(message)
    })
  }
  return { app, config, pool, registry, bridge }
}
```

- [ ] **Step 2: 写 src/agent/e2e.test.ts**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'
import pg from 'pg'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'
import { StubProvider } from '../model/stub.js'

const open = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })

function collect(ws: WebSocket): { messages: string[]; waitFor: (count: number) => Promise<void> } {
  const messages: string[] = []
  ws.on('message', (data) => messages.push(data.toString()))
  return {
    messages,
    waitFor: (count: number) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (messages.length >= count) resolve()
          else setTimeout(check, 10)
        }
        check()
      }),
  }
}

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  if (address === null || typeof address === 'string') throw new Error('unexpected address')
  return address.port
}

describe('agent e2e (mention → reply → ws push)', () => {
  let built: BuiltApp
  let pool: pg.Pool
  let stub: StubProvider

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
    stub = new StubProvider('好的，我来实现报销系统。')
    built = await buildApp(
      { databaseUrl: 'postgres://ta:ta@localhost:5432/ta_dev', modelApiKey: 'sk-test' },
      { provider: stub },
    )
  })
  afterEach(async () => {
    await built.app.close()
  })

  async function loginAs(username: string): Promise<string> {
    const res = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username } })
    return res.json().token as string
  }

  it('user @mentions Ta-Fullstack and receives the agent reply over ws', async () => {
    const alice = await loginAs('alice')
    const sessionRes = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-alice'] },
    })
    const sessionId = sessionRes.json().session.id as string

    const port = await listen(built.app)
    const aliceWs = await open(`ws://127.0.0.1:${port}/ws?token=${await loginAs('alice')}`)
    const coll = collect(aliceWs)
    await coll.waitFor(1) // welcome

    const send = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'mention-1', contentType: 'text', content: '@Ta-Fullstack 帮我做报销系统' },
    })
    expect(send.statusCode).toBe(201)

    // welcome + 用户消息 + agent 回复 = 3 帧
    await coll.waitFor(3)
    const last = JSON.parse(coll.messages[2] as string) as {
      type: string
      message: { senderKind: string; senderId: string; content: string; seq: number }
    }
    expect(last.type).toBe('message.new')
    expect(last.message.senderKind).toBe('agent')
    expect(last.message.senderId).toBe('agent-ta-fullstack')
    expect(last.message.content).toBe('好的，我来实现报销系统。')
    expect(last.message.seq).toBe(2)
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]!.userInput).toBe('帮我做报销系统')

    aliceWs.close()
  })

  it('does not trigger the agent without a mention', async () => {
    const alice = await loginAs('alice')
    const sessionRes = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${alice}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-alice'] },
    })
    const sessionId = sessionRes.json().session.id as string

    await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { clientMsgId: 'plain-1', contentType: 'text', content: '大家好' },
    })

    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(stub.calls).toHaveLength(0)
  })
})
```

- [ ] **Step 3: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: typecheck exit 0；新增 e2e.test 2 用例全 PASS；全部既有用例不回归（总用例 = 44 + 3 provider + 5 bridge + 2 e2e = 54）。

- [ ] **Step 4: 提交**

```bash
git add services/gateway
git commit -m "feat(gateway): 智能体桥接接线（events 驱动 + 端到端测试）"
```

---

## Task 4: 收尾（README + 全仓验收 + 推送）

**Files:**
- Modify: `README.md`（根）

- [ ] **Step 1: README 追加「智能体（Ta-Fullstack）」节**

在 `### 消息引擎冒烟` 之后追加：

```markdown
### 智能体（Ta-Fullstack）

网关内置模型网关（DeepSeek，OpenAI 兼容）。会话内 `@Ta-Fullstack <需求>` 即触发智能体，回复以 agent 身份实时推回会话。

```bash
# 模型凭证（来自 Harness 凭据文件 ~/.dsh/.credentials.yaml 的 DEEPSEEK_API_KEY）
export MODEL_API_KEY=<你的 DeepSeek key>
pnpm dev:gateway

# 会话内发：@Ta-Fullstack 帮我做报销系统
# → Ta-Fullstack 的回复经 WS 实时出现在会话里（senderKind=agent）
```

> 未配置 `MODEL_API_KEY` 时智能体自动禁用（`agentEnabled=false`），消息引擎其余功能不受影响。`MODEL_BASE_URL` / `MODEL_NAME`（默认 `deepseek-chat`）可覆盖。
```

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm build
pnpm test
pnpm install --frozen-lockfile
```

Expected: build 全过；test 全绿（contracts 2 + gateway 52 = 54）；frozen-lockfile 通过；`git status` 干净（除 README）。

- [ ] **Step 3: 提交 + 推送**

```bash
git add README.md
git commit -m "docs: README 补智能体（Ta-Fullstack）配置与触发说明"
git push
```

Expected: 推送成功。

---

## Self-Review 记录（写完后自查）

- **Spec 覆盖**：路线图 M0.4（模型网关最小版）→ Task 1；M0.5（智能体接入/@触发/静默策略）→ Task 2/3；PR-5 克制发言（仅 @ 触发）→ bridge 提取逻辑 + 非 @ 跳过测试；PR-6 成本（门控 + 长度守卫 + token 日志）→ config.agentEnabled/agentMaxPromptChars/日志。
- **占位符扫描**：无 TBD；persona 镜像常量完整。
- **类型一致性**：`ModelProvider.complete(systemPrompt, userInput)` 在 provider/deepseek/stub/bridge/测试一致；`AgentBridge.handle` 返回 `MentionResult` 在 bridge/测试一致；`buildApp(overrides?, deps?)` 在既有测试（两参兼容）与 e2e 一致。
- **环境事实**：Node 24 全局 fetch 可用；DeepSeek key 位于 `~/.dsh/.credentials.yaml`（不写入任何文件）；无新 npm 依赖。
- **已知取舍**：persona 镜像常量（生产化改读 preset 文件）；token 计量仅日志（DB 计量表延后）；桥接任务进程内异步（队列/重试延后）；agent 回复失败发错误消息（后续可改静默 + 通知）。
