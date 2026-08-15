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

  it('passes an abort signal for timeout protection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init: { signal?: AbortSignal }) => {
      expect(init.signal).toBeDefined()
      return Promise.reject(new Error('aborted'))
    }))
    const provider = new DeepSeekProvider({ apiKey: 'k', baseUrl: 'https://api.deepseek.com', model: 'm' })
    await expect(provider.complete('s', 'u')).rejects.toThrow(/aborted/)
  })
})
