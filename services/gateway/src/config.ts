export interface Config {
  port: number
  jwtSecret: string
  jwtExpiresIn: string
}

const DEV_SECRET = 'dev-secret-do-not-use-in-prod'

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = env.JWT_SECRET ?? DEV_SECRET
  if (env.NODE_ENV === 'production' && jwtSecret === DEV_SECRET) {
    throw new Error('JWT_SECRET must be set in production')
  }
  return {
    port: Number(env.PORT ?? 3001),
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? '7d',
  }
}
