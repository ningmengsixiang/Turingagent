import pg from 'pg'
import type { ActorKind, Message, MessageContentType } from '@ta/contracts'
import { isMessageContentType } from '@ta/contracts'

export interface MessageRow {
  id: string
  session_id: string
  sender_id: string
  sender_kind: string
  content_type: string
  ref_kind: string | null
  ref_id: string | null
  reply_to: string | null
  content: string
  client_msg_id: string
  seq: string
  created_at: Date
}

export function mapMessage(row: MessageRow): Message {
  const contentType: MessageContentType = isMessageContentType(row.content_type)
    ? row.content_type
    : 'text'
  return {
    id: row.id,
    clientMsgId: row.client_msg_id,
    sessionId: row.session_id,
    senderId: row.sender_id,
    senderKind: row.sender_kind as ActorKind,
    contentType,
    ref:
      row.ref_kind && row.ref_id
        ? { kind: row.ref_kind as 'approval' | 'task', id: row.ref_id }
        : undefined,
    replyTo: row.reply_to ?? undefined,
    content: row.content,
    seq: Number(row.seq),
    createdAt: row.created_at.toISOString(),
  }
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint?: string }
  return e.code === '23505' && e.constraint === constraint
}

export class MessageRefError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MessageRefError'
  }
}

export async function createMessage(
  pool: pg.Pool,
  input: {
    sessionId: string
    senderId: string
    senderKind: ActorKind
    contentType: MessageContentType
    content: string
    clientMsgId: string
    ref?: { kind: 'approval' | 'task'; id: string }
    replyTo?: string
  },
): Promise<{ message: Message; created: boolean }> {
  const existing = await pool.query<MessageRow>(
    'SELECT * FROM messages WHERE sender_id = $1 AND client_msg_id = $2',
    [input.senderId, input.clientMsgId],
  )
  if (existing.rows[0]) return { message: mapMessage(existing.rows[0]), created: false }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (input.replyTo) {
      const ref = await client.query<{ id: string }>(
        'SELECT id FROM messages WHERE id = $1 AND session_id = $2',
        [input.replyTo, input.sessionId],
      )
      if (!ref.rows[0]) throw new MessageRefError('replyTo message not found in this session')
    }
    const seqRes = await client.query<{ last_seq: string }>(
      'UPDATE sessions SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq',
      [input.sessionId],
    )
    if (!seqRes.rows[0]) throw new Error(`session not found: ${input.sessionId}`)
    const seq = Number(seqRes.rows[0].last_seq)
    const ins = await client.query<MessageRow>(
      `INSERT INTO messages (session_id, sender_id, sender_kind, content_type, content, client_msg_id, seq, ref_kind, ref_id, reply_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [input.sessionId, input.senderId, input.senderKind, input.contentType, input.content, input.clientMsgId, seq, input.ref?.kind ?? null, input.ref?.id ?? null, input.replyTo ?? null],
    )
    await client.query('COMMIT')
    return { message: mapMessage(ins.rows[0]!), created: true }
  } catch (err) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(err, 'messages_sender_id_client_msg_id_key')) {
      // 必须在同一 client 上回查（Blocker 修复）：此时 client 已 ROLLBACK 空闲；
      // 若用 pool.query 借新连接，并发重复发送 ≥ 池上限时会池自死锁
      const dup = await client.query<MessageRow>(
        'SELECT * FROM messages WHERE sender_id = $1 AND client_msg_id = $2',
        [input.senderId, input.clientMsgId],
      )
      if (dup.rows[0]) return { message: mapMessage(dup.rows[0]), created: false }
    }
    throw err
  } finally {
    client.release()
  }
}

export async function listMessages(
  pool: pg.Pool,
  sessionId: string,
  afterSeq: number,
  limit: number,
): Promise<Message[]> {
  const res = await pool.query<MessageRow & { reply_preview: string | null }>(
    `SELECT m.*, r.content AS reply_preview
       FROM messages m
       LEFT JOIN messages r ON r.id = m.reply_to
      WHERE m.session_id = $1 AND m.seq > $2
      ORDER BY m.seq ASC LIMIT $3`,
    [sessionId, afterSeq, limit],
  )
  return res.rows.map((row) => {
    const message = mapMessage(row)
    if (row.reply_preview) {
      message.replyPreview = row.reply_preview.length > 80 ? row.reply_preview.slice(0, 80) + '…' : row.reply_preview
    }
    return message
  })
}

export async function updateMessageContent(
  pool: pg.Pool,
  messageId: string,
  content: string,
): Promise<Message | null> {
  const res = await pool.query<MessageRow>(
    'UPDATE messages SET content = $2 WHERE id = $1 RETURNING *',
    [messageId, content],
  )
  return res.rows[0] ? mapMessage(res.rows[0]) : null
}
