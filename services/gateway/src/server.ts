import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { loadConfig, type Config } from './config.js'
import { createPool } from './db.js'
import { createRegistry, type ConnectionRegistry } from './registry.js'
import { createEvents } from './events.js'
import { registerHealth } from './routes/health.js'
import { registerAuth } from './routes/auth.js'
import { registerMe } from './routes/me.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { registerMessageRoutes } from './routes/messages.js'
import { registerWs } from './ws.js'
import pg from 'pg'

export interface BuiltApp {
  app: ReturnType<typeof Fastify>
  config: Config
  pool: pg.Pool
  registry: ConnectionRegistry
}

export async function buildApp(overrides?: Partial<Config>): Promise<BuiltApp> {
  const config = { ...loadConfig(), ...overrides }
  const app = Fastify({ logger: false, ajv: { customOptions: { coerceTypes: false } } })
  const pool = createPool(config.databaseUrl)
  const registry = createRegistry()
  const events = createEvents()
  app.addHook('onClose', async () => {
    await pool.end()
  })
  await app.register(websocket)
  registerHealth(app)
  registerAuth(app, config)
  registerMe(app, config)
  registerSessionRoutes(app, config, pool)
  registerMessageRoutes(app, config, pool, (message) => {
    events.emit('message.created', message)
  })
  registerWs(app, config, pool, registry, events)
  return { app, config, pool, registry }
}
