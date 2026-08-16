import type { FastifyInstance } from 'fastify'
import type { Message } from '@ta/contracts'
import { randomUUID } from 'node:crypto'
import type { Client } from 'minio'
import { requireAuth } from '../middleware.js'
import { isMember } from '../repos/sessions.js'
import { createMessage } from '../repos/messages.js'
import { createFile, getFile, listFilesForSession } from '../repos/files.js'
import { ensureBucket, putObject, presignedGetUrl } from '../storage.js'
import type { Config } from '../config.js'
import pg from 'pg'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

export function registerFileRoutes(
  app: FastifyInstance,
  config: Config,
  pool: pg.Pool,
  storage: Client,
  emitMessageCreated: (message: Message) => void,
): void {
  const auth = requireAuth(config, pool)

  app.post<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/files',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      if (!UUID_PATTERN.test(sessionId)) {
        return reply.code(400).send({ error: 'session id must be a uuid' })
      }
      const userId = request.user!.id
      if (!(await isMember(pool, sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const data = await request.file()
      if (!data) return reply.code(400).send({ error: 'file is required' })
      const name = data.filename.trim()
      const mime = data.mimetype || 'application/octet-stream'
      if (!name) return reply.code(400).send({ error: 'filename is required' })

      const buffer = await data.toBuffer()
      if (buffer.length > MAX_FILE_SIZE) {
        return reply.code(413).send({ error: 'file too large (max 20MB)' })
      }

      const fileId = randomUUID()
      const storageKey = `files/${fileId}`
      await ensureBucket(storage, config.minioBucket)
      await putObject(storage, config.minioBucket, storageKey, buffer, buffer.length, mime)
      const file = await createFile(pool, {
        sessionId,
        name,
        size: buffer.length,
        mime,
        storageKey,
        uploadedBy: userId,
      })
      const { message } = await createMessage(pool, {
        sessionId,
        senderId: userId,
        senderKind: 'human',
        contentType: 'file',
        content: name,
        clientMsgId: `file-${file.id}`,
        ref: { kind: 'file', id: file.id },
      })
      emitMessageCreated(message)
      return reply.code(201).send({ file, message })
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/v1/files/:id',
    { preHandler: auth },
    async (request, reply) => {
      const fileId = request.params.id
      if (!UUID_PATTERN.test(fileId)) {
        return reply.code(400).send({ error: 'file id must be a uuid' })
      }
      const userId = request.user!.id
      const file = await getFile(pool, fileId)
      if (!file) return reply.code(404).send({ error: 'file not found' })
      if (!(await isMember(pool, file.sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of the file session' })
      }
      // FileInfo 契约不含 storage_key（内部 MinIO key），此处单独取
      const keyRes = await pool.query<{ storage_key: string }>('SELECT storage_key FROM files WHERE id = $1', [fileId])
      const storageKey = keyRes.rows[0]?.storage_key
      if (!storageKey) return reply.code(404).send({ error: 'file not found' })
      const url = await presignedGetUrl(storage, config.minioBucket, storageKey)
      return { url, file }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/files',
    { preHandler: auth },
    async (request, reply) => {
      const sessionId = request.params.id
      if (!UUID_PATTERN.test(sessionId)) {
        return reply.code(400).send({ error: 'session id must be a uuid' })
      }
      const userId = request.user!.id
      if (!(await isMember(pool, sessionId, userId))) {
        return reply.code(403).send({ error: 'not a member of this session' })
      }
      const files = await listFilesForSession(pool, sessionId)
      return { files }
    },
  )
}
