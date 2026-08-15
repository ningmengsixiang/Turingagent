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
})
