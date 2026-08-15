export interface Config {
  port: number
  jwtSecret: string
  jwtExpiresIn: string
}

const DEV_SECRET = 'dev-secret-do-not-use-in-prod'
const MIN_SECRET_LENGTH = 32

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = env.JWT_SECRET ?? DEV_SECRET
  const envName = env.NODE_ENV ?? '(unset)'
  const isDev = envName === 'development' || envName === 'test'
  if (!isDev && (jwtSecret === DEV_SECRET || jwtSecret.length < MIN_SECRET_LENGTH)) {
    throw new Error(
      `JWT_SECRET must be a strong secret (>=${MIN_SECRET_LENGTH} chars) in non-development environments (NODE_ENV=${envName}); for local dev set NODE_ENV=development`,
    )
  }
  const port = Number(env.PORT ?? 3001)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer in [1, 65535], got: ${env.PORT}`)
  }
  return {
    port,
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? '7d',
  }
}
