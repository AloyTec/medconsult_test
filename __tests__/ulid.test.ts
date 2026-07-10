/**
 * @jest-environment node
 */
// __tests__/ulid.test.ts
import { ulid, isUlid } from '@/lib/ulid'

describe('ulid', () => {
  it('produces 26 Crockford-base32 chars', () => {
    const id = ulid()
    expect(id).toHaveLength(26)
    expect(isUlid(id)).toBe(true)
  })

  it('orders lexicographically by timestamp', () => {
    const a = ulid(1_000_000)
    const b = ulid(2_000_000)
    expect(a < b).toBe(true)
  })

  it('rejects non-ULIDs', () => {
    expect(isUlid('not-a-ulid')).toBe(false)
    expect(isUlid('')).toBe(false)
    expect(isUlid(undefined)).toBe(false)
    expect(isUlid('ILOU' + 'A'.repeat(22))).toBe(false) // I, L, O, U excluded
  })
})
