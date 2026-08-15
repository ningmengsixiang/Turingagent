import { jwtVerify, SignJWT } from 'jose'
import type { Config } from './config.js'

export interface JwtUser {
  id: string
  name: string
}

export async function signToken(user: JwtUser, config: Config): Promise<string> {
  const secret = new TextEncoder().encode(config.jwtSecret)
  return new SignJWT({ name: user.name })
    .setSubject(user.id)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.jwtExpiresIn)
    .sign(secret)
}

export async function verifyToken(token: string, config: Config): Promise<JwtUser | null> {
  try {
    const secret = new TextEncoder().encode(config.jwtSecret)
    const { payload } = await jwtVerify(token, secret)
    if (typeof payload.sub !== 'string' || typeof payload.name !== 'string') return null
    return { id: payload.sub, name: payload.name }
  } catch {
    return null
  }
}
