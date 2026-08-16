import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { loadConfig } from '../config.js'
import { StubProvider } from '../model/stub.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'
import { createSession } from '../repos/sessions.js'
import { createMessage, listMessages } from '../repos/messages.js'
import { AgentBridge } from './bridge.js'
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
    const userMsg = userMessage('@Ta-Fullstack 帮我做报销系统')
    await createMessage(pool, {
      sessionId: userMsg.sessionId,
      senderId: userMsg.senderId,
      senderKind: 'human',
      contentType: 'text',
      content: userMsg.content,
      clientMsgId: userMsg.clientMsgId,
    })
    const result = await bridge.handle(userMsg)
    expect(result.triggered).toBe(true)
    expect(result.agentId).toBe('agent-ta-fullstack')
    expect(result.reply?.senderId).toBe('agent-ta-fullstack')
    expect(result.reply?.senderKind).toBe('agent')
    expect(result.reply?.content).toBe('收到，我来实现报销系统。')
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0]!.userInput).toBe('帮我做报销系统')
    expect(provider.calls[0]!.systemPrompt).toContain('软件生成智能体')
    expect(emitted).toHaveLength(1)
    const messages = await listMessages(pool, sessionId, 0, 10)
    expect(messages).toHaveLength(2)
    expect(messages[1]!.senderKind).toBe('agent')
    expect(messages[1]!.seq).toBe(2)
  })

  it('routes to the mentioned agent with its persona', async () => {
    const { bridge, provider } = makeBridge('收到')
    const cases = [
      { content: '@Ta-PM 帮我澄清报销需求', agentId: 'agent-ta-pm', persona: '需求经理智能体' },
      { content: '@Ta-Architect 评估这个变更', agentId: 'agent-ta-architect', persona: '架构师智能体' },
      { content: '@Ta-QA 验收一下', agentId: 'agent-ta-qa', persona: '测试智能体' },
    ]
    for (const c of cases) {
      const result = await bridge.handle(userMessage(c.content))
      expect(result.triggered).toBe(true)
      expect(result.agentId).toBe(c.agentId)
      expect(result.reply?.senderId).toBe(c.agentId)
      const last = provider.calls[provider.calls.length - 1]!
      expect(last.systemPrompt).toContain(c.persona)
    }
  })

  it('skips non-mention messages', async () => {
    const { bridge, provider } = makeBridge()
    const result = await bridge.handle(userMessage('今天天气不错'))
    expect(result.triggered).toBe(false)
    expect(result.skippedReason).toBe('silent')
    expect(provider.calls).toHaveLength(0)
  })

  it('skips card messages even if they contain @-mentions (T2 质量审查)', async () => {
    const { bridge, provider } = makeBridge()
    const card = { ...userMessage('📋 待开始：支付网关对接（负责人 @Ta-Fullstack）'), contentType: 'task_card' as const }
    const result = await bridge.handle(card)
    expect(result.skippedReason).toBe('not-a-mention')
    expect(provider.calls).toHaveLength(0)
  })

  it('skips agent messages (loop breaker)', async () => {
    const { bridge, provider } = makeBridge()
    const result = await bridge.handle({ ...userMessage('@Ta-Fullstack x'), senderKind: 'agent', senderId: 'agent-ta-fullstack' })
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

  it('skips when the requirement exceeds the prompt char limit', async () => {
    const provider = new StubProvider()
    const config = loadConfig({ NODE_ENV: 'test', DEEPSEEK_API_KEY: 'sk-test', AGENT_MAX_PROMPT_CHARS: '20' })
    const bridge = new AgentBridge({ pool, config, provider, emitMessageCreated: () => {} })
    const result = await bridge.handle(userMessage('@Ta-Fullstack ' + '很长的需求内容'.repeat(10)))
    expect(result.skippedReason).toBe('too-long')
    expect(provider.calls).toHaveLength(0)
    const messages = await listMessages(pool, sessionId, 0, 10)
    expect(messages).toHaveLength(0)
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
    const result = await bridge.handle(userMessage('@Ta-PM 帮我做东西'))
    expect(result.triggered).toBe(true)
    expect(result.agentId).toBe('agent-ta-pm')
    expect(result.skippedReason).toBe('error')
    expect(result.reply?.content).toBe('⚠️ Ta-PM 处理失败，请稍后重试。')
    expect(emitted).toHaveLength(1)
    const messages = await listMessages(pool, sessionId, 0, 10)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.content).toBe('⚠️ Ta-PM 处理失败，请稍后重试。')
  })

  it('triggers on consecutive mention messages (无 lastIndex 泄漏)', async () => {
    const { bridge } = makeBridge('好的')
    const first = await bridge.handle(userMessage('@Ta-PM 第一个需求'))
    const second = await bridge.handle(userMessage('@Ta-PM 第二个需求'))
    expect(first.triggered).toBe(true)
    expect(second.triggered).toBe(true)
    const messages = await listMessages(pool, sessionId, 0, 10)
    expect(messages).toHaveLength(2)
  })

  it('responds via Ta-PM on decision point without mention', async () => {
    const { bridge } = makeBridge()
    const res = await bridge.handle({
      id: 'm-d1',
      clientMsgId: 'c-d1',
      sessionId,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content: '这个方案你定吧',
      seq: 2,
      createdAt: new Date().toISOString(),
    } as Message)
    expect(res.triggered).toBe(true)
    expect(res.agentId).toBe('agent-ta-pm')
    expect(res.reply?.senderId).toBe('agent-ta-pm')
  })

  it('stays silent on idle chat (no provider call)', async () => {
    const { bridge, provider } = makeBridge()
    const res = await bridge.handle({
      id: 'm-s1',
      clientMsgId: 'c-s1',
      sessionId,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content: '哈哈哈哈',
      seq: 3,
      createdAt: new Date().toISOString(),
    } as Message)
    expect(res.triggered).toBe(false)
    expect(res.skippedReason).toBe('silent')
    expect(provider.calls).toHaveLength(0)
  })

  it('responds via Ta-PM on keyword signal without mention', async () => {
    const { bridge } = makeBridge()
    const res = await bridge.handle({
      id: 'm-k1',
      clientMsgId: 'c-k1',
      sessionId,
      senderId: 'u-alice',
      senderKind: 'human',
      contentType: 'text',
      content: '测试用例写完了，开始验收',
      seq: 4,
      createdAt: new Date().toISOString(),
    } as Message)
    expect(res.triggered).toBe(true)
    expect(res.agentId).toBe('agent-ta-pm')
  })
})
