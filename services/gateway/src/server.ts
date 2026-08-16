import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import multipart from '@fastify/multipart'
import { loadConfig, type Config } from './config.js'
import { createPool } from './db.js'
import { createRegistry, type ConnectionRegistry } from './registry.js'
import { createEvents } from './events.js'
import { createModelProvider, type ModelProvider } from './model/provider.js'
import { AgentBridge } from './agent/bridge.js'
import { registerHealth } from './routes/health.js'
import { registerAuth } from './routes/auth.js'
import { registerMe } from './routes/me.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { registerMessageRoutes } from './routes/messages.js'
import { registerApprovalRoutes } from './routes/approvals.js'
import { registerTaskRoutes } from './routes/tasks.js'
import { registerOrgRoutes } from './routes/org.js'
import { registerSkillRoutes } from './routes/skills.js'
import { registerKbRoutes } from './routes/kb.js'
import { registerApiKeyRoutes } from './routes/api-keys.js'
import { registerTemplateRoutes } from './routes/templates.js'
import { registerMarketplaceRoutes } from './routes/marketplace.js'
import { registerExternalRoutes } from './routes/external.js'
import { registerFileRoutes } from './routes/files.js'
import { registerMemoryRoutes } from './routes/memories.js'
import { registerWs } from './ws.js'
import { createStorage } from './storage.js'
import pg from 'pg'

export interface BuiltApp {
  app: ReturnType<typeof Fastify>
  config: Config
  pool: pg.Pool
  registry: ConnectionRegistry
  bridge: AgentBridge | null
}

export interface BuildDeps {
  /** 测试注入：覆盖默认 DeepSeek provider */
  provider?: ModelProvider
}

export async function buildApp(overrides?: Partial<Config>, deps?: BuildDeps): Promise<BuiltApp> {
  const merged = { ...loadConfig(), ...overrides }
  // agentEnabled 是 modelApiKey 的派生字段（见 config.ts）：overrides 覆盖 modelApiKey
  // 时若不显式给出 agentEnabled，必须同步重新派生，否则注入测试 key 后智能体仍处于禁用态
  const config: Config =
    overrides?.agentEnabled === undefined
      ? { ...merged, agentEnabled: merged.modelApiKey.length > 0 }
      : merged
  const app = Fastify({ logger: false, ajv: { customOptions: { coerceTypes: false } } })
  const pool = createPool(config.databaseUrl)
  const storage = createStorage(config)
  const registry = createRegistry()
  const events = createEvents()
  app.addHook('onClose', async () => {
    await pool.end()
  })
  await app.register(websocket)
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } })
  registerHealth(app)
  registerAuth(app, config, pool)
  registerMe(app, config)
  registerSessionRoutes(app, config, pool)
  registerMessageRoutes(app, config, pool, (message) => {
    events.emit('message.created', message)
  })
  registerApprovalRoutes(
    app,
    config,
    pool,
    (message) => events.emit('message.created', message),
    (message) => events.emit('message.updated', message),
  )
  registerTaskRoutes(
    app,
    config,
    pool,
    (message) => events.emit('message.created', message),
    (message) => events.emit('message.updated', message),
  )
  registerOrgRoutes(app, config, pool)
  registerSkillRoutes(app, config, pool)
  registerKbRoutes(app, config, pool)
  registerApiKeyRoutes(app, config, pool)
  registerTemplateRoutes(app, config, pool)
  registerMarketplaceRoutes(app, config, pool)
  registerExternalRoutes(app, config, pool)
  registerFileRoutes(app, config, pool, storage, (message) => events.emit('message.created', message))
  registerWs(app, config, pool, registry, events)

  const provider = deps?.provider ?? createModelProvider(config)
  registerMemoryRoutes(app, config, pool, provider)
  const bridge =
    provider === null
      ? null
      : new AgentBridge({
          pool,
          config,
          provider,
          emitMessageCreated: (message) => events.emit('message.created', message),
        })
  if (bridge) {
    events.on('message.created', (message) => {
      // 异步触发智能体；失败不崩溃进程（桥接内部已全函数化）
      void bridge.handle(message).catch((err) => console.error('[agent] unhandled:', err))
    })
  }
  return { app, config, pool, registry, bridge }
}
