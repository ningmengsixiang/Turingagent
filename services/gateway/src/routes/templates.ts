import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware.js'
import { listTemplates } from '../repos/templates.js'
import type { Config } from '../config.js'
import pg from 'pg'

export function registerTemplateRoutes(app: FastifyInstance, config: Config, pool: pg.Pool): void {
  const auth = requireAuth(config, pool)

  app.get('/api/v1/templates', { preHandler: auth }, async () => {
    return { templates: listTemplates() }
  })
}
