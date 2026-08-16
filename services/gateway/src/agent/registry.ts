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
  // 取消息中最早出现的提及（内容序，T2 质量审查：注册序会让 @Ta-QA…@Ta-PM… 错回给 PM）；
  // 无 /g，无 lastIndex 泄漏；空提及跳过
  let best: { agent: AgentDefinition; requirement: string; index: number } | null = null
  for (const agent of AGENTS) {
    const match = agent.mentionPattern.exec(content)
    if (!match) continue
    const requirement = content.slice(match.index + match[0].length).trim()
    if (requirement.length === 0) continue
    if (!best || match.index < best.index) {
      best = { agent, requirement, index: match.index }
    }
  }
  return best ? { agent: best.agent, requirement: best.requirement } : null
}

/** 前端显示名映射（senderId → displayName） */
export const AGENT_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a.displayName]),
)
