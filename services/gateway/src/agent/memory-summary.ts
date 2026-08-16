import type { Message } from '@ta/contracts'

export const MEMORY_SUMMARY_PROMPT = `你是 Turing Agent 的记忆沉淀助手。请把以下会话讨论整理成结构化记忆文档，包含四个小节：
1. 需求基线（明确的需求与范围）
2. 关键决策（讨论中确定的决策）
3. 待办事项（未完成的行动项）
4. 未决问题（讨论中未解决的疑问）

要求：简洁、要点化、中文；只总结讨论中实际出现的内容，不臆造。以下是会话消息（格式：发送者: 内容）：`

const MAX_MESSAGES = 50

/** 收集会话最近文本消息（跳过卡片），格式化为摘要输入 */
export function collectMessagesForSummary(messages: Message[]): string {
  const recent = messages
    .filter((m) => m.contentType === 'text')
    .slice(-MAX_MESSAGES)
  if (recent.length === 0) return ''
  return recent.map((m) => `${m.senderKind === 'agent' ? m.senderId : m.senderId}: ${m.content}`).join('\n')
}

export function buildSummaryPrompt(transcript: string): string {
  return `${MEMORY_SUMMARY_PROMPT}\n${transcript}`
}

export function memoryTitleForToday(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `会话记忆 ${y}-${m}-${d}`
}
