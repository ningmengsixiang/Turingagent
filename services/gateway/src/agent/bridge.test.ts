import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { loadConfig } from '../config.js'
import { StubProvider } from '../model/stub.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'
import { createSession } from '../repos/sessions.js'
import { createMessage, listMessages } from '../repos/messages.js'
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
    const userMsg = userMessage('@Ta-Fullstack 帮我做报销系统')
    // 用户消息先落库（真实流程中由路由写入），bridge 只负责 agent 回复
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
    expect(result.reply?.senderId).toBe(AGENT_USER_ID)
    expect(result.reply?.senderKind).toBe('agent')
    expect(result.reply?.content).toBe('收到，我来实现报销系统。')
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0]!.userInput).toBe('帮我做报销系统')
    expect(provider.calls[0]!.systemPrompt).toContain('你是 Ta-Fullstack')
    expect(emitted).toHaveLength(1)
    const messages = await listMessages(pool, sessionId, 0, 10)
    expect(messages).toHaveLength(2) // 用户消息 + agent 回复
    expect(messages[1]!.senderKind).toBe('agent')
    expect(messages[1]!.seq).toBe(2)
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
    // I2：用户侧固定文案，不泄露原始错误
    expect(result.reply?.content).toBe('⚠️ Ta-Fullstack 处理失败，请稍后重试。')
    expect(emitted).toHaveLength(1)
    const messages = await listMessages(pool, sessionId, 0, 10)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.content).toBe('⚠️ Ta-Fullstack 处理失败，请稍后重试。')
  })

  it('triggers on consecutive mention messages (B1 回归：无 /g lastIndex 泄漏)', async () => {
    const { bridge } = makeBridge('好的')
    const first = await bridge.handle(userMessage('@Ta-Fullstack 第一个需求'))
    const second = await bridge.handle(userMessage('@Ta-Fullstack 第二个需求'))
    expect(first.triggered).toBe(true)
    expect(second.triggered).toBe(true)
    const messages = await listMessages(pool, sessionId, 0, 10)
    expect(messages).toHaveLength(2)
  })

  it('skips when the requirement exceeds the prompt char limit (I3：PR-6 长度守卫)', async () => {
    const provider = new StubProvider()
    const config = loadConfig({ NODE_ENV: 'test', DEEPSEEK_API_KEY: 'sk-test', AGENT_MAX_PROMPT_CHARS: '20' })
    const bridge = new AgentBridge({ pool, config, provider, emitMessageCreated: () => {} })
    const result = await bridge.handle(userMessage('@Ta-Fullstack ' + '很长的需求内容'.repeat(10)))
    expect(result.skippedReason).toBe('too-long')
    expect(provider.calls).toHaveLength(0)
    const messages = await listMessages(pool, sessionId, 0, 10)
    expect(messages).toHaveLength(0)
  })
})
