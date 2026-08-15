import { buildApp } from './server.js'

const { app, config } = await buildApp()
try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`gateway listening on http://0.0.0.0:${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
