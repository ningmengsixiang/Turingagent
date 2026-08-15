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
