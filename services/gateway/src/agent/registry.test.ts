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
