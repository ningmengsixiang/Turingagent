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
