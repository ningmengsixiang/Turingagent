import type { Message } from '@ta/contracts'
import { randomUUID } from 'node:crypto'
import type { Config } from '../config.js'
import type { ModelProvider } from '../model/provider.js'
import { createMessage } from '../repos/messages.js'
import { checkQuota, recordUsage } from '../repos/quota.js'
import { classifySilence } from './silence.js'
import { AGENTS, findAgentByMention, type AgentDefinition } from './registry.js'
import { agentRunsTotal, agentTokensTotal } from '../metrics.js'
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
  /** 未触发原因：silent = 无 @ 提及且静默策略判闲聊（FR-CHAT-05，零 LLM 成本跳过）；not-a-mention = 非文本消息；quota = 配额已熔断（FR-ORG-07，未调 provider） */
  skippedReason?: 'not-a-mention' | 'agent-message' | 'disabled' | 'too-long' | 'error' | 'silent' | 'quota'
}

export class AgentBridge {
  constructor(private readonly options: AgentBridgeOptions) {}

  async handle(message: Message): Promise<MentionResult> {
    if (message.senderKind === 'agent') return { triggered: false, skippedReason: 'agent-message' }
    if (message.contentType !== 'text') return { triggered: false, skippedReason: 'not-a-mention' } // 卡片内嵌 @ 提及不触发（T2 质量审查）
    if (!this.options.config.agentEnabled) return { triggered: false, skippedReason: 'disabled' }

    const hit = findAgentByMention(message.content)
    if (hit) {
      if (hit.requirement.length > this.options.config.agentMaxPromptChars) {
        return { triggered: false, skippedReason: 'too-long' }
      }
      return this.runAgent(message, hit.agent, hit.requirement)
    }

    // 无 @ 提及：静默策略（FR-CHAT-05）——respond 路由 Ta-PM（仲裁者），silent 零成本跳过
    const decision = classifySilence(message.content)
    if (decision.decision === 'silent') return { triggered: false, skippedReason: 'silent' }
    if (message.content.length > this.options.config.agentMaxPromptChars) {
      return { triggered: false, skippedReason: 'too-long' }
    }
    const pm = AGENTS.find((a) => a.id === 'agent-ta-pm')
    if (!pm) {
      console.error('[agent] Ta-PM not found in registry; silent policy disabled')
      return { triggered: false, skippedReason: 'not-a-mention' }
    }
    return this.runAgent(message, pm, message.content)
  }

  private async runAgent(
    message: Message,
    agent: AgentDefinition,
    requirement: string,
  ): Promise<MentionResult> {
    // 配额熔断（FR-ORG-07）：熔断只影响智能体执行，IM 主链路不受影响
    const trip = await checkQuota(this.options.pool)
    if (trip) {
      agentRunsTotal.inc({ agent: agent.id, outcome: 'quota' })
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
      agentRunsTotal.inc({ agent: agent.id, outcome: 'success' })
      agentTokensTotal.inc(completion.promptTokens + completion.completionTokens)
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
      agentRunsTotal.inc({ agent: agent.id, outcome: 'error' })
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
