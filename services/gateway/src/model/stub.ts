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
