/** 参与者类型：人类与智能体在系统中地位对等（PRD §1.3 混合团队） */
export type ActorKind = 'human' | 'agent'

/** 消息内容类型（契约唯一事实来源，TechDesign：packages/contracts 是协议唯一事实来源） */
export const MessageContentType = {
  Text: 'text',
  File: 'file',
  Image: 'image',
  Voice: 'voice',
  System: 'system',
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
  role: ActorKind
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
  /** 客户端生成的幂等键（TechDesign：POST 消息幂等 client_msg_id，离线重发去重） */
  clientMsgId: string
  sessionId: string
  senderId: string
  senderKind: ActorKind
  contentType: MessageContentType
  /** 文本内容（卡片/文件类的展示文本）；结构化负载由 Plan 2 补齐 */
  content: string
  /** 卡片等消息引用的业务对象（如审批） */
  ref?: { kind: 'approval' | 'task'; id: string }
  seq: number
  createdAt: string
  updatedAt?: string
}

export const ApprovalStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
} as const
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus]

export interface Approval {
  id: string
  sessionId: string
  title: string
  description?: string
  status: ApprovalStatus
  approverId: string
  createdBy: string
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
  assigneeKind: ActorKind
  status: TaskStatus
  dueAt?: string
}

export interface WsMessageNew {
  type: 'message.new'
  message: Message
}

export interface WsMessageUpdated {
  type: 'message.updated'
  message: Message
}

export type WsEvent = WsMessageNew | WsMessageUpdated

export interface OrgMember {
  userId: string
  name: string
  role: 'admin' | 'member'
  createdAt: string
}

export interface AuditEvent {
  id: string
  actorId: string
  action: string
  target?: string
  detail: Record<string, unknown>
  createdAt: string
}

export interface Memory {
  id: string
  sessionId: string
  title: string
  content: string
  currentVersion: number
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface MemoryVersion {
  id: string
  memoryId: string
  version: number
  content: string
  editedBy: string
  createdAt: string
}
