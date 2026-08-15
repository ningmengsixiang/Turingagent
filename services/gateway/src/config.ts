export interface Config {
  port: number
  jwtSecret: string
  jwtExpiresIn: string
  databaseUrl: string
  modelApiKey: string
  modelBaseUrl: string
  modelName: string
  agentEnabled: boolean
  agentMaxPromptChars: number
}

const DEV_SECRET = 'dev-secret-do-not-use-in-prod'
const MIN_SECRET_LENGTH = 32
const DEV_DATABASE_URL = 'postgres://ta:ta@localhost:5432/ta_dev'

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
  const databaseUrl = env.DATABASE_URL ?? DEV_DATABASE_URL
  if (!isDev && databaseUrl === DEV_DATABASE_URL) {
    throw new Error(`DATABASE_URL must be set in non-development environments (NODE_ENV=${envName})`)
  }
  const modelApiKey = env.MODEL_API_KEY ?? env.DEEPSEEK_API_KEY ?? ''
  const agentMaxPromptChars = Number(env.AGENT_MAX_PROMPT_CHARS ?? 4000)
  if (!Number.isInteger(agentMaxPromptChars) || agentMaxPromptChars < 1) {
    throw new Error(`AGENT_MAX_PROMPT_CHARS must be a positive integer, got: ${env.AGENT_MAX_PROMPT_CHARS}`)
  }
  return {
    port,
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? '7d',
    databaseUrl,
    modelApiKey,
    modelBaseUrl: env.MODEL_BASE_URL ?? 'https://api.deepseek.com',
    modelName: env.MODEL_NAME ?? 'deepseek-chat',
    agentEnabled: modelApiKey.length > 0,
    agentMaxPromptChars,
  }
}
