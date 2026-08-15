import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { loadConfig, type Config } from './config.js'
import { registerHealth } from './routes/health.js'
import { registerAuth } from './routes/auth.js'
import { registerMe } from './routes/me.js'
import { registerWs } from './ws.js'

export interface BuiltApp {
  app: ReturnType<typeof Fastify>
  config: Config
}

export async function buildApp(overrides?: Partial<Config>): Promise<BuiltApp> {
  const config = { ...loadConfig(), ...overrides }
  const app = Fastify({ logger: false })
  await app.register(websocket)
  registerHealth(app)
  registerAuth(app, config)
  registerMe(app, config)
  registerWs(app, config)
  return { app, config }
}
