// lib/ulid.ts
// ULID (Crockford base32): 48-bit timestamp + 80 bits de aleatoriedad → 26 chars,
// ordena lexicográficamente por tiempo (por eso sirve de sort key newest-first).
// Sin dependencia externa; corre en browser y en node (globalThis.crypto).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function ulid(now: number = Date.now()): string {
  let ts = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    ts = ALPHABET[t % 32] + ts
    t = Math.floor(t / 32)
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  let rand = ''
  for (let i = 0; i < 16; i++) rand += ALPHABET[bytes[i] % 32]
  return ts + rand
}

// El id viaja del browser al server y se usa como sort key: validar SIEMPRE en el server.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_RE.test(value)
}
