// lib/access-gate.ts
// Código de acceso compartido del POC: token = HMAC(secret, código) en una cookie
// httpOnly; proxy.ts decide con decideAccess(). Doble llave (código + secret en env):
// sin ambas configuradas el gate queda INERTE (dev local y tests no se bloquean).
// Corre en el runtime nodejs (proxy de Next 16) — node:crypto disponible.
import { createHmac, timingSafeEqual } from 'crypto'

export const ACCESS_COOKIE = 'mc_access'

export function accessToken(secret: string, code: string): string {
  return createHmac('sha256', secret).update(`medconsult-poc-access:${code}`).digest('hex')
}

function verifyToken(token: string | undefined, secret: string, code: string): boolean {
  if (!token) return false
  const expected = Buffer.from(accessToken(secret, code))
  const actual = Buffer.from(token)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export type GateDecision = 'allow' | 'unauthorized-api' | 'redirect-acceso'

const PUBLIC_PREFIXES = ['/acceso', '/api/acceso', '/_next', '/favicon.ico']

export function decideAccess(
  pathname: string,
  token: string | undefined,
  env: { code?: string; secret?: string }
): GateDecision {
  if (!env.code || !env.secret) return 'allow' // gate inerte hasta configurar env
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
  if (isPublic) return 'allow'
  if (verifyToken(token, env.secret, env.code)) return 'allow'
  return pathname.startsWith('/api/') ? 'unauthorized-api' : 'redirect-acceso'
}
