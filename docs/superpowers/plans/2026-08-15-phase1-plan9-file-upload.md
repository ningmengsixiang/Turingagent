# Phase 1 · 计划 9：文件上传（MinIO + 文件消息）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地群内文件能力（FR-CHAT-08 群内文件管理、FR-DESK-02 文件拖拽）：文件上传到 MinIO（S3 兼容对象存储）→ 生成文件消息（contentType=file，带文件名/大小/类型）→ 下载走预签名 URL；前端输入区文件按钮 + 拖拽上传 + 文件消息渲染（📎 + 下载链接）。

**Architecture:** `deploy/docker-compose.yml` 增 MinIO 服务 → `src/storage.ts`（MinIO 客户端工厂 + ensureBucket）→ `007_files.sql` 迁移（files 表）→ `routes/files.ts`（`@fastify/multipart` 上传 → MinIO putObject + files 行 + file 消息 emit；GET 预签名下载 URL；GET 会话文件列表）→ 契约 `Message.file` 字段 + `FileInfo` 类型。前端：input area 文件按钮（隐藏 input）+ 拖拽、上传后重拉消息、文件气泡渲染下载链接。

**Tech Stack:** 新增依赖 `minio`（S3 客户端）与 `@fastify/multipart`（multipart 解析）；MinIO 容器（minio/minio:latest，9000 API / 9001 控制台）；测试用真实 MinIO（docker compose）+ 上传小文件断言。

**决策记录：** 存储 key = `files/<uuid>`（内容寻址，防重名冲突）；下载 = 预签名 URL（15 分钟过期，前端点击时获取，避免网关代理大文件）；上传权限 = 会话成员；文件大小上限 20MB（@fastify/multipart limits）；文件消息 content = 文件名，`Message.file` 携带结构化元数据；MinIO 凭据 dev 默认 `taadmin/ta12345678`（compose 同步，生产环境变量覆盖）。

**评审决策（T3 质量审查后追加）：**
- 预签名下载 URL 必须带 `response-content-disposition: attachment; filename*=UTF-8''...`（minio 第 4 参 respHeaders）：MinIO :9000 与 Web :5173 跨域，`<a download>` 被忽略，无 Content-Disposition 时浏览器会导航到 MinIO 页/内联预览并丢文件名；中文文件名用 RFC 5987 `filename*`。
- `uploadFile` 裸 fetch 需与 `request()` 一致的 401 处理（clearToken + `ta:unauthorized` 事件），否则 token 过期上传时应用不登出、token 残留。
- 已知取舍（记入后续任务）：上传无前端大小预检（413 提示不友好）、无会话时上传静默丢弃（应与 send 一样 ensureSession）、上传/下载交互路径测试缺口、路由内 MAX_FILE_SIZE 检查为死代码（multipart 插件先行拦截）、`.file-bubble` 缺 word-break、多选文件只取第一个。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `deploy/docker-compose.yml` | 修改 | 增 minio 服务 |
| `services/gateway/src/config.ts` | 修改 | 增 minio 配置 |
| `services/gateway/src/storage.ts` | 创建 | MinIO 客户端工厂 + ensureBucket |
| `services/gateway/migrations/007_files.sql` | 创建 | files 表 |
| `services/gateway/src/repos/files.ts` | 创建 | 文件仓储 |
| `services/gateway/src/routes/files.ts` | 创建 | 上传/下载/列表路由 |
| `services/gateway/src/server.ts` | 修改 | 注册 multipart + 文件路由 |
| `packages/contracts/src/index.ts` | 修改 | FileInfo + Message.file |
| `services/gateway/src/routes/files.test.ts` | 创建 | 文件路由测试 |
| `services/gateway/package.json` | 修改 | 增 minio/@fastify/multipart 依赖 |
| `apps/web/src/api/client.ts` | 修改 | uploadFile/下载 URL API |
| `apps/web/src/pages/Chat.tsx` | 修改 | 文件按钮/拖拽/文件消息 |
| `apps/web/src/pages/Chat.test.tsx` | 修改 | 文件用例 |
| `apps/web/src/app.css` | 修改 | 文件样式 |
| `README.md` | 修改 | 文件说明 |

---

## Task 1: MinIO 基建 + 迁移 + 契约 + 文件仓储

**Files:**
- Modify: `deploy/docker-compose.yml`
- Modify: `services/gateway/src/config.ts`
- Create: `services/gateway/src/storage.ts`
- Create: `services/gateway/migrations/007_files.sql`
- Create: `services/gateway/src/repos/files.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `services/gateway/package.json`

- [ ] **Step 1: docker-compose 增 minio 服务**

在 `db` 服务之后追加：

```yaml
  minio:
    image: minio/minio:latest
    container_name: ta-minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: taadmin
      MINIO_ROOT_PASSWORD: ta12345678
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - ta-minio-data:/data

volumes:
  ta-minio-data:
```

（`volumes:` 已有 ta-pgdata，追加 ta-minio-data。）

- [ ] **Step 2: config.ts 增 minio 配置**

Config 接口增：

```ts
  minioEndpoint: string
  minioAccessKey: string
  minioSecretKey: string
  minioBucket: string
  minioUseSsl: boolean
```

loadConfig return 增：

```ts
    minioEndpoint: env.MINIO_ENDPOINT ?? 'localhost:9000',
    minioAccessKey: env.MINIO_ACCESS_KEY ?? 'taadmin',
    minioSecretKey: env.MINIO_SECRET_KEY ?? 'ta12345678',
    minioBucket: env.MINIO_BUCKET ?? 'ta-files',
    minioUseSsl: env.MINIO_USE_SSL === 'true',
```

- [ ] **Step 3: 写 storage.ts**

```ts
import { Client } from 'minio'
import type { Config } from './config.js'

export function createStorage(config: Config): Client {
  return new Client({
    endPoint: config.minioEndpoint.split(':')[0]!,
    port: Number(config.minioEndpoint.split(':')[1] ?? 9000),
    useSSL: config.minioUseSsl,
    accessKey: config.minioAccessKey,
    secretKey: config.minioSecretKey,
  })
}

export async function ensureBucket(client: Client, bucket: string): Promise<void> {
  const exists = await client.bucketExists(bucket)
  if (!exists) {
    await client.makeBucket(bucket)
  }
}

/** 上传 Buffer 到存储，返回存储 key */
export async function putObject(
  client: Client,
  bucket: string,
  key: string,
  buffer: Buffer,
  size: number,
  mime: string,
): Promise<void> {
  await client.putObject(bucket, key, buffer, size, { 'Content-Type': mime })
}

/** 生成预签名下载 URL（默认 15 分钟） */
export async function presignedGetUrl(
  client: Client,
  bucket: string,
  key: string,
  expiresSeconds = 900,
): Promise<string> {
  return client.presignedGetObject(bucket, key, expiresSeconds)
}
```

- [ ] **Step 4: 写 migrations/007_files.sql**

```sql
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size BIGINT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  storage_key TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_files_session ON files (session_id);
```

- [ ] **Step 5: 写 repos/files.ts**

```ts
import pg from 'pg'
import type { FileInfo } from '@ta/contracts'

export interface FileRow {
  id: string
  session_id: string
  name: string
  size: string
  mime: string
  storage_key: string
  uploaded_by: string
  created_at: Date
}

export function mapFile(row: FileRow): FileInfo {
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    size: Number(row.size),
    mime: row.mime,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at.toISOString(),
  }
}

export async function createFile(
  pool: pg.Pool,
  input: { sessionId: string; name: string; size: number; mime: string; storageKey: string; uploadedBy: string },
): Promise<FileInfo> {
  const res = await pool.query<FileRow>(
    `INSERT INTO files (session_id, name, size, mime, storage_key, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.sessionId, input.name, input.size, input.mime, input.storageKey, input.uploadedBy],
  )
  return mapFile(res.rows[0]!)
}

export async function getFile(pool: pg.Pool, id: string): Promise<FileInfo | null> {
  const res = await pool.query<FileRow>('SELECT * FROM files WHERE id = $1', [id])
  return res.rows[0] ? mapFile(res.rows[0]) : null
}

export async function listFilesForSession(pool: pg.Pool, sessionId: string): Promise<FileInfo[]> {
  const res = await pool.query<FileRow>('SELECT * FROM files WHERE session_id = $1 ORDER BY created_at DESC', [sessionId])
  return res.rows.map(mapFile)
}
```

- [ ] **Step 6: contracts 增 FileInfo + Message.file**

文件末尾追加：

```ts
export interface FileInfo {
  id: string
  sessionId: string
  name: string
  size: number
  mime: string
  uploadedBy: string
  createdAt: string
}
```

Message 接口增（`replyPreview?` 之后）：

```ts
  /** 文件消息的元数据（contentType === 'file' 时存在） */
  file?: { id: string; name: string; size: number; mime: string }
```

- [ ] **Step 7: package.json 增依赖**

dependencies 增 `"@fastify/multipart": "^9.0.0"`、`"minio": "^8.0.2"`（在 jose 之后）。

- [ ] **Step 8: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml up -d minio
pnpm install
pnpm --filter @ta/contracts build
pnpm --filter @ta/gateway migrate
pnpm --filter @ta/gateway typecheck
```

Expected: minio 容器启动（健康后 9000 端口就绪）；install 装新依赖；migrate 应用 007；typecheck exit 0（此时 files.ts 尚无消费方，storage.ts 未使用——不影响编译）。

- [ ] **Step 9: 提交**

```bash
git add deploy services/gateway packages/contracts pnpm-lock.yaml
git commit -m "feat(file): MinIO 基建 + 文件仓储 + 迁移 007 + 契约"
```

---

## Task 2: 文件路由

**Files:**
- Create: `services/gateway/src/routes/files.ts`
- Create: `services/gateway/src/routes/files.test.ts`
- Modify: `services/gateway/src/server.ts`

- [ ] **Step 1: 写 routes/files.ts**

```ts
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
        file: { id: file.id, name, size: buffer.length, mime },
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
      const url = await presignedGetUrl(storage, config.minioBucket, file.storageKey)
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
```

> 注：`createMessage` 需要支持 `file` 字段——messages 表无 file 列，文件元数据只存在 messages.content（文件名）+ files 表（完整元数据）。**简化决策**：`createMessage` 的 input 不加 file 参数，文件消息 content = 文件名即可；`Message.file` 字段由前端在渲染时通过 messages 列表里的 file 元数据填充？——不对，列表返回的 Message 无 file。**修订**：列表查询 LEFT JOIN files（`m.ref` 不适用——用新约定：文件消息的 `content` 存文件名，前端要下载时用 messages 里的 `clientMsgId` 解析？太绕）。**改用 ref 机制**：文件消息 ref = `{ kind: 'file', id: fileId }`，`listMessages` 的 LEFT JOIN 增 file 元数据（`r2.name/r2.size/r2.mime AS file_*`），mapMessage 填充 `file`。实现时以「ref 指向 files 表 + 列表 JOIN 取元数据」为准，类型正确即可。

- [ ] **Step 2: server.ts**

1. import 增 `multipart`（`@fastify/multipart`）、`registerFileRoutes`、`createStorage`。
2. `await app.register(websocket)` 之后：`await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } })`。
3. provider 定义处附近创建 storage：`const storage = createStorage(config)`。
4. 注册路由：`registerFileRoutes(app, config, pool, storage, (message) => events.emit('message.created', message))`。

- [ ] **Step 3: 写 routes/files.test.ts**

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import FormData from 'form-data'
import { buildApp, type BuiltApp } from '../server.js'
import { createTestPool, truncateAll } from '../repos/test-helpers.js'

describe('file routes', () => {
  let built: BuiltApp
  let pool: pg.Pool

  beforeAll(async () => {
    pool = await createTestPool()
  })
  afterAll(async () => {
    await pool.end()
  })
  beforeEach(async () => {
    await truncateAll(pool)
    built = await buildApp({ databaseUrl: 'postgres://ta:ta@localhost:5432/ta_dev' })
  })
  afterEach(async () => {
    await built.app.close()
  })

  async function loginAs(username: string): Promise<string> {
    const res = await built.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username } })
    return res.json().token as string
  }

  async function createProjectSession(token: string): Promise<string> {
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'project', title: '报销系统', memberIds: ['u-bob'] },
    })
    return res.json().session.id as string
  }

  it('uploads a file and creates a file message', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const form = new FormData()
    form.append('file', Buffer.from('hello file content'), { filename: '需求文档.txt', contentType: 'text/plain' })
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/files`,
      headers: { authorization: `Bearer ${alice}`, ...form.getHeaders() },
      payload: form.getBuffer(),
    })
    expect(res.statusCode).toBe(201)
    const { file, message } = res.json()
    expect(file.name).toBe('需求文档.txt')
    expect(file.size).toBeGreaterThan(0)
    expect(message.contentType).toBe('file')
    expect(message.content).toBe('需求文档.txt')
  })

  it('returns a download url for a file', async () => {
    const alice = await loginAs('alice')
    const sessionId = await createProjectSession(alice)
    const form = new FormData()
    form.append('file', Buffer.from('download me'), { filename: 'a.txt', contentType: 'text/plain' })
    const upload = await built.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/files`,
      headers: { authorization: `Bearer ${alice}`, ...form.getHeaders() },
      payload: form.getBuffer(),
    })
    const fileId = upload.json().file.id as string
    const res = await built.app.inject({
      method: 'GET',
      url: `/api/v1/files/${fileId}`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.url).toContain('X-Amz-Signature') // 预签名 URL
  })
})
```

> 注：`form-data` 需要 devDep（`"form-data": "^4.0.0"`）。测试依赖 MinIO 容器运行（`docker compose up -d minio`）。

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml up -d minio
sleep 5
docker compose -f deploy/docker-compose.yml ps
pnpm install
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose
```

Expected: minio healthy；typecheck exit 0；新增文件路由 2 用例全 PASS（需 MinIO 可用）；总用例 = 123 + 2 = 125。

- [ ] **Step 5: 提交**

```bash
git add services/gateway pnpm-lock.yaml
git commit -m "feat(file): 文件路由（multipart 上传/预签名下载/列表）"
```

## Task 3: 前端文件

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/Chat.tsx`
- Modify: `apps/web/src/pages/Chat.test.tsx`
- Modify: `apps/web/src/app.css`

- [x] **Step 1: client.ts 增文件 API**

```ts
import type { Approval, FileInfo, Memory, ... } from '@ta/contracts'
```

追加：

```ts
export const uploadFile = async (sessionId: string, file: File): Promise<{ file: FileInfo; message: Message }> => {
  const token = getToken()
  const form = new FormData()
  form.append('file', file, file.name)
  const res = await fetch(`/api/v1/sessions/${sessionId}/files`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `http ${res.status}`)
  }
  return (await res.json()) as { file: FileInfo; message: Message }
}

export const getFileDownloadUrl = (fileId: string): Promise<{ url: string; file: FileInfo }> =>
  request(`/api/v1/files/${fileId}`)
```

- [x] **Step 2: Chat.tsx 文件按钮/拖拽/文件消息**

1. 状态增 `const fileInputRef = useRef<HTMLInputElement | null>(null)`。

2. send 函数旁增 upload：

```tsx
  async function upload(files: FileList | null) {
    if (!activeId || !files || files.length === 0) return
    const file = files[0]!
    setError(null)
    try {
      await uploadFile(activeId, file)
      await loadMessages(activeId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    }
  }
```

3. footer input area 加文件按钮 + 隐藏 input：

```tsx
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => { void upload(e.target.files); e.target.value = '' }}
          />
          <button className="ghost" onClick={() => fileInputRef.current?.click()}>📎</button>
```

4. input-area 加拖拽（onDragOver preventDefault + onDrop 上传）：

```tsx
        <footer
          className="input-area"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void upload(e.dataTransfer.files) }}
        >
```

5. 文件消息渲染（isCard/isTask 分支后加 isFile）：

```tsx
            const isFile = m.contentType === 'file'
```
渲染分支：
```tsx
                ) : isFile ? (
                  <div className="file-bubble">
                    <span>📎 {m.content}</span>
                    {m.ref?.kind === 'file' ? (
                      <button className="ghost small" onClick={() => void downloadFile(m.ref!.id, m.content)}>下载</button>
                    ) : null}
                  </div>
                ) : (
```

6. downloadFile：

```tsx
  async function downloadFile(fileId: string, name: string) {
    try {
      const { url } = await getFileDownloadUrl(fileId)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载失败')
    }
  }
```

- [x] **Step 3: app.css 增文件样式**

```css
.file-bubble { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px solid #e5e5ea; border-radius: 14px; background: #f5f5f7; font-size: 14px; }
```

- [x] **Step 4: Chat.test.tsx 补文件用例**

```tsx
  it('renders a file message', async () => {
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': {
        messages: [
          { id: 'm1', clientMsgId: 'c1', sessionId: 's1', senderId: 'u-alice', senderKind: 'human', contentType: 'file', content: '需求文档.txt', seq: 1, createdAt: '', ref: { kind: 'file', id: 'f1' } },
        ],
      },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [{ userId: 'u-alice', name: 'alice', kind: 'human' }] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    render(<Chat onLogout={vi.fn()} />)
    expect(await screen.findByText(/需求文档.txt/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /下载/ })).toBeTruthy()
  })
```

- [x] **Step 5: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose
pnpm --filter @ta/web build
```

Expected: typecheck exit 0；web 测试 19 用例全 PASS；build 产出 dist/。

- [x] **Step 6: 提交**

```bash
git add apps/web
git commit -m "feat(web): 文件上传（按钮/拖拽）与文件消息"
```

## Task 4: 收尾（README + 全仓验收 + 推送）

**Files:**
- Modify: `README.md`（根）

- [ ] **Step 1: README 追加「文件」节**

在「### 任务看板」之后追加：

```markdown
### 文件上传

```bash
# 需要 MinIO（docker compose 已含；MINIO_* 环境变量可覆盖）
curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/files \
  -H "authorization: Bearer $TOKEN" -F "file=@<本地文件>"
# → 生成文件消息（contentType=file）；下载：GET /api/v1/files/<fileId> 返回 15 分钟预签名 URL
```
```

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
```

Expected: build 全过；test 全绿（contracts 2 + gateway 125 + web 19 = 146）；frozen-lockfile 通过；`git status` 干净（除 README）。

- [ ] **Step 3: 提交 + 推送**

```bash
git add README.md
git commit -m "docs: README 补文件上传说明"
git push
```

Expected: 推送成功。

---

## Self-Review 记录（写完后自查）

- **Spec 覆盖**：FR-CHAT-08（群内文件管理）→ Task 1/2/3；FR-DESK-02（文件拖拽）→ Task 3；TechDesign 对象存储（MinIO/S3）→ Task 1。
- **占位符扫描**：无 TBD；Task 2 的 createMessage file 字段注明实现取舍（ref → files 表 JOIN）。
- **类型一致性**：`FileInfo` 在 contracts/repo/路由/前端一致；`Message.file` 在 contracts/mapMessage/前端一致；storage 函数签名一致。
- **已知取舍**：下载走预签名 URL（不经网关代理）；上传 20MB 上限；无文件删除/回收站（Phase 2）；无文件预览（图片缩略图 Phase 2）；MinIO 单节点（生产多节点/云 S3 后续）。
