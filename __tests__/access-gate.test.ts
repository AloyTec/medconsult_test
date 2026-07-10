/**
 * @jest-environment node
 */
// __tests__/access-gate.test.ts
import { accessToken, decideAccess, ACCESS_COOKIE } from '@/lib/access-gate'

const ENV = { code: 'clave-doctor', secret: 'super-secreto' }
const GOOD = accessToken(ENV.secret, ENV.code)

describe('accessToken', () => {
  it('is deterministic hex and changes with code or secret', () => {
    expect(GOOD).toMatch(/^[0-9a-f]{64}$/)
    expect(accessToken(ENV.secret, 'otra')).not.toBe(GOOD)
    expect(accessToken('otro-secreto', ENV.code)).not.toBe(GOOD)
  })
})

describe('decideAccess', () => {
  it('is inert (allow-all) until the env vars are configured', () => {
    expect(decideAccess('/prompts', undefined, {})).toBe('allow')
    expect(decideAccess('/api/extract', undefined, { code: 'x' })).toBe('allow') // falta secret
  })

  it('always allows the public paths', () => {
    expect(decideAccess('/acceso', undefined, ENV)).toBe('allow')
    expect(decideAccess('/api/acceso', undefined, ENV)).toBe('allow')
    expect(decideAccess('/_next/static/x.js', undefined, ENV)).toBe('allow')
    expect(decideAccess('/favicon.ico', undefined, ENV)).toBe('allow')
  })

  it('allows a valid cookie everywhere', () => {
    expect(decideAccess('/prompts', GOOD, ENV)).toBe('allow')
    expect(decideAccess('/api/extract', GOOD, ENV)).toBe('allow')
  })

  it('401s APIs and redirects pages without/with bad cookie', () => {
    expect(decideAccess('/api/extract', undefined, ENV)).toBe('unauthorized-api')
    expect(decideAccess('/api/extract', 'bad-token', ENV)).toBe('unauthorized-api')
    expect(decideAccess('/prompts', undefined, ENV)).toBe('redirect-acceso')
    expect(decideAccess('/historial', 'bad-token', ENV)).toBe('redirect-acceso')
  })

  it('does not treat /accesoX as public', () => {
    expect(decideAccess('/accesoX', undefined, ENV)).toBe('redirect-acceso')
  })
})

it('exports the cookie name', () => {
  expect(ACCESS_COOKIE).toBe('mc_access')
})
