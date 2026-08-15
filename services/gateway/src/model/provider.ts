import type { Config } from '../config.js'
import { DeepSeekProvider } from './deepseek.js'

export interface ModelCompletion {
  content: string
  promptTokens: number
  completionTokens: number
}

export interface ModelProvider {
  /** 系统提示 + 用户输入，返回补全结果 */
  complete(systemPrompt: string, userInput: string): Promise<ModelCompletion>
}

export function createModelProvider(config: Config): ModelProvider | null {
  if (!config.agentEnabled) return null
  return new DeepSeekProvider({
    apiKey: config.modelApiKey,
    baseUrl: config.modelBaseUrl,
    model: config.modelName,
  })
}
