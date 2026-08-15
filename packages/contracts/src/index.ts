/** 消息内容类型（契约唯一事实来源，TechDesign：packages/contracts 是协议唯一事实来源） */
export const MessageContentType = {
  Text: 'text',
  File: 'file',
  ConfirmationCard: 'confirmation_card',
  TaskCard: 'task_card',
} as const
export type MessageContentType = (typeof MessageContentType)[keyof typeof MessageContentType]

export const isMessageContentType = (v: unknown): v is MessageContentType =>
  typeof v === 'string' && (Object.values(MessageContentType) as string[]).includes(v)

export interface User {
  id: string
  name: string
  avatar?: string
  role: 'human' | 'agent'
  agentRole?: 'ta-pm' | 'ta-architect' | 'ta-fullstack' | 'ta-qa'
}

export interface Session {
  id: string
  kind: 'direct' | 'project' | 'group'
  title: string
  memberIds: string[]
}

export interface Message {
  id: string
  sessionId: string
  senderId: string
  senderKind: 'human' | 'agent'
  contentType: MessageContentType
  content: string
  seq: number
  createdAt: string
}

export const ApprovalStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
} as const
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus]

export interface Approval {
  id: string
  title: string
  status: ApprovalStatus
  approverId: string
  reason?: string
  createdAt: string
  decidedAt?: string
}

export const TaskStatus = {
  Todo: 'todo',
  InProgress: 'in_progress',
  Blocked: 'blocked',
  Done: 'done',
} as const
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus]

export interface Task {
  id: string
  sessionId: string
  title: string
  assigneeId: string
  assigneeKind: 'human' | 'agent'
  status: TaskStatus
  dueAt?: string
}
