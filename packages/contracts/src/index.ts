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
  /** ABAC：归属部门（项目会话可见性属性） */
  departmentId?: string
  /** 多租户（FR-ORG-01/FR-SEC-02）：会话归属租户（创建时继承创建者租户） */
  tenantId?: string
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
  ref?: { kind: 'approval' | 'task' | 'file'; id: string }
  /** 引用回复：被引消息 id */
  replyTo?: string
  /** 被引消息摘要（服务端生成，前端渲染引用行） */
  replyPreview?: string
  /** 文件消息的元数据（contentType === 'file' 时存在） */
  file?: { id: string; name: string; size: number; mime: string }
  seq: number
  createdAt: string
  updatedAt?: string
}

export const ApprovalStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
  Returned: 'returned',
  Cancelled: 'cancelled',
} as const
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus]

export const ApprovalNodeMode = {
  Single: 'single',
  All: 'all',
  Any: 'any',
} as const
export type ApprovalNodeMode = (typeof ApprovalNodeMode)[keyof typeof ApprovalNodeMode]

export const ApprovalNodeStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
} as const
export type ApprovalNodeStatus = (typeof ApprovalNodeStatus)[keyof typeof ApprovalNodeStatus]

export interface ApprovalNode {
  /** 节点序号（0 起，串行顺序） */
  index: number
  /** 单人/会签/或签 */
  mode: ApprovalNodeMode
  /** 审批人（人类，不得为 agent） */
  approverIds: string[]
  status: ApprovalNodeStatus
  /** 最终裁决人（节点完成后） */
  decidedBy?: string
  reason?: string
  decidedAt?: string
}

export interface Approval {
  id: string
  sessionId: string
  title: string
  description?: string
  status: ApprovalStatus
  /** 兼容字段：当前激活节点（currentNode）的第一个审批人；单级 = 原 approverId */
  approverId: string
  createdBy: string
  reason?: string
  createdAt: string
  decidedAt?: string
  /** 顶层模式（单节点时 = 该节点 mode） */
  mode: ApprovalNodeMode
  /** 当前激活节点序号 */
  currentNodeIndex: number
  /** 重提版本（resubmit 后 +1） */
  version: number
  /** 超时升级次数（FR-APP-06） */
  escalatedCount?: number
  /** 流程节点列表（按 index 升序） */
  nodes: ApprovalNode[]
}

export const isApprovalNodeMode = (v: unknown): v is ApprovalNodeMode =>
  typeof v === 'string' && (Object.values(ApprovalNodeMode) as string[]).includes(v)

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
  /** 多租户（FR-ORG-01/FR-SEC-02）：用户归属租户 */
  tenantId?: string
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

export interface SessionMember {
  userId: string
  name: string
  kind: 'human' | 'agent'
}

export interface FileInfo {
  id: string
  sessionId: string
  name: string
  size: number
  mime: string
  uploadedBy: string
  createdAt: string
}

export interface Skill {
  id: string
  name: string
  description: string
  /** 工具白名单（声明式元数据；实际工具执行层 Phase 2 落地） */
  toolAllowlist: string[]
}

export const QuotaLevel = {
  Enterprise: 'enterprise',
  Project: 'project',
  Task: 'task',
} as const
export type QuotaLevel = (typeof QuotaLevel)[keyof typeof QuotaLevel]

export interface QuotaStatus {
  level: QuotaLevel
  /** 预算（tokens） */
  budget: number
  /** 已用（tokens） */
  used: number
  /** 0-1 比例 */
  ratio: number
  /** 是否熔断（used >= budget） */
  tripped: boolean
}

export interface KbDocument {
  id: string
  sessionId: string
  title: string
  content: string
  createdBy: string
  createdAt: string
}

export interface Department {
  id: string
  name: string
  createdAt: string
}

export interface ApiKeyInfo {
  id: string
  /** 脱敏显示（ta_****abcd） */
  name: string
  /** 脱敏 key 尾缀 */
  maskedKey: string
  memberUserId: string
  createdAt: string
  revokedAt?: string
}

export const TenantStatus = {
  Active: 'active',
  Suspended: 'suspended',
} as const
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus]

export interface Tenant {
  id: string
  name: string
  status: TenantStatus
  createdAt: string
}
