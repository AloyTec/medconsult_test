# Historial de Atenciones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every atención (transcript + STT usado + prompts + extraction runs + validación + resumen, con engine/modelo de cada paso) anonymized in DynamoDB, gate the whole app behind a shared access code, and add a read-only `/historial` view.

**Architecture:** The client generates a `atencionId` (ULID) per dictation session and sends it as an optional, additive field on the existing `/api/extract`, `/api/validate`, `/api/summarize` POSTs. Those routes persist best-effort (never blocking the clinical response) after scrubbing patient identifiers. A single-partition DynamoDB table (`pk='ATENCION'`, `sk=ULID`) gives newest-first listing with one Query — no Scan; runs use an optimistic lock, validación/resumen use `UpdateItem` on independent attributes so in-flight writes never clobber each other. A Next 16 `proxy.ts` gates every page/API behind an HMAC-signed cookie set by `/acceso`.

**Tech Stack:** Next.js 16 App Router (note: middleware file is `proxy.ts` with `export default function proxy`, runtime nodejs; route-handler `params` is a Promise), TypeScript, Jest 30 (`next/jest`, jsdom default — server tests need `@jest-environment node` docblock), `@aws-sdk/lib-dynamodb`, `@vercel/oidc-aws-credentials-provider` (existing OIDC pattern from `lib/bedrock.ts`).

**Spec:** `docs/superpowers/specs/2026-07-10-historial-atenciones-design.md` (v2 — updated 2026-07-10 after the adversarial review)

**Base branch:** `origin/main` (has PR #9+#10 — `__tests__/bedrock.test.ts` exists there; the user's checkout `docs/poc-testing` does NOT have them). Work in a worktree; never touch the user's checkout.

**Conventions to follow:** comments in Spanish/English mix matching each file; server AWS clients cached + `awsCredentialsProvider` only when `AWS_ROLE_ARN` is set (see `lib/bedrock.ts:12-24`); UI uses the existing `card`, `field`, color classes.

**Visibility contract (the product goal — every task serves this):** each atención must make visible (1) el transcript enviado, (2) el STT usado (`openai-realtime` | `transcribe` | `texto`), (3) la IA usada (engine + modelo) de CADA paso, (4) los prompts usados de los TRES pasos, (5) los resultados de los tres pasos.

---

### Task 0: Worktree, branch, deps, baseline

**Files:**
- Create: worktree at `../medconsult_test-historial` on branch `feat/historial-atenciones`
- Modify: `package.json` (2 new deps)
- Copy in: `docs/superpowers/specs/2026-07-10-historial-atenciones-design.md`, `docs/superpowers/plans/2026-07-10-historial-atenciones.md` (they live on `docs/poc-testing`)

- [ ] **Step 1: Create the worktree from origin/main**

```bash
cd /Users/victorbarrantes/Desktop/coding/cloudforge-ai/clients/medconsult/medconsult_test
git fetch origin main
git worktree add ../medconsult_test-historial -b feat/historial-atenciones origin/main
cd ../medconsult_test-historial
```

- [ ] **Step 2: Bring the spec + plan onto the feature branch**

```bash
mkdir -p docs/superpowers/specs docs/superpowers/plans
git -C ../medconsult_test show docs/poc-testing:docs/superpowers/specs/2026-07-10-historial-atenciones-design.md > docs/superpowers/specs/2026-07-10-historial-atenciones-design.md
git -C ../medconsult_test show docs/poc-testing:docs/superpowers/plans/2026-07-10-historial-atenciones.md > docs/superpowers/plans/2026-07-10-historial-atenciones.md
git add docs && git commit -m "docs: spec + plan historial de atenciones"
```

- [ ] **Step 3: Install deps and verify baseline**

```bash
npm install --save @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
npm test
npx tsc --noEmit
```
Expected: all existing tests pass (bedrock + extraction-schema), tsc clean.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add DynamoDB SDK deps for historial de atenciones"
```

---

### Task 1: `lib/ulid.ts` — client/server ULID helper

**Files:**
- Create: `lib/ulid.ts`
- Test: `__tests__/ulid.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/ulid.test.ts`
Expected: FAIL — cannot find module '@/lib/ulid'

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/ulid.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ulid.ts __tests__/ulid.test.ts
git commit -m "feat: ULID helper (id de atención, time-ordered)"
```

---

### Task 2: `lib/anonymize.ts` — pseudonym + scrub

**Files:**
- Create: `lib/anonymize.ts`
- Test: `__tests__/anonymize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
// __tests__/anonymize.test.ts
// La anonimización aplica SOLO a lo persistido (spec §Anonimización): seudónimo
// determinístico + reemplazo de identificadores extraídos + regex RUT best-effort.
import { pseudonymFor, scrubText, scrubExtractedData } from '@/lib/anonymize'
import type { ExtractedData } from '@/lib/types'

const PATIENT = {
  name: 'Juan',
  lastName: 'Pérez',
  age: 45,
  document: '12345678-5',
  docType: 1,
}

describe('pseudonymFor', () => {
  it('is deterministic per atención and looks like "Paciente XXXX"', () => {
    const a = pseudonymFor('01JZXA0000000000000000000A')
    expect(a).toBe(pseudonymFor('01JZXA0000000000000000000A'))
    expect(a).toMatch(/^Paciente [0-9A-Z]{1,4}$/)
    expect(a).not.toBe(pseudonymFor('01JZXA0000000000000000000B'))
  })
})

describe('scrubText', () => {
  const P = 'Paciente A1B2'

  it('replaces name and lastName case-insensitively', () => {
    const out = scrubText('paciente JUAN pérez consulta', PATIENT, P)
    expect(out).not.toMatch(/juan/i)
    expect(out).not.toMatch(/pérez/i)
    expect(out).toContain(P)
  })

  it('masks RUTs in dotted and plain formats', () => {
    const out = scrubText('RUT 12.345.678-5 o 12345678-5', PATIENT, P)
    expect(out).not.toContain('12.345.678-5')
    expect(out).not.toContain('12345678-5')
    expect(out).toContain('RUT-OCULTO')
  })

  it('does not replace identifiers shorter than 3 chars (avoids nuking substrings)', () => {
    const out = scrubText('Alto y ancho', { ...PATIENT, name: 'Al', lastName: null, document: null }, P)
    expect(out).toBe('Alto y ancho')
  })

  it('handles null patient', () => {
    expect(scrubText('sin datos', null, P)).toBe('sin datos')
  })
})

describe('scrubExtractedData', () => {
  it('pseudonymizes patient fields and scrubs sections', () => {
    const data: ExtractedData = {
      patient: PATIENT,
      clinicalSections: {
        antecedentes: 'Juan Pérez con gastritis',
        anamnesis: null,
        examenFisico: 'sin hallazgos',
        diagnostico: 'gastritis aguda',
        plan: 'control de Juan en una semana',
      },
    }
    const out = scrubExtractedData(data, 'Paciente A1B2')
    expect(out.patient.name).toBe('Paciente A1B2')
    expect(out.patient.lastName).toBeNull()
    expect(out.patient.document).toBeNull()
    expect(out.patient.age).toBe(45) // edad se conserva (no identifica por sí sola)
    expect(out.clinicalSections.antecedentes).not.toMatch(/juan|pérez/i)
    expect(out.clinicalSections.plan).not.toMatch(/juan/i)
    expect(out.clinicalSections.examenFisico).toBe('sin hallazgos')
    // el original NO se muta (la respuesta en vivo lleva datos reales)
    expect(data.patient.name).toBe('Juan')
    expect(data.clinicalSections.antecedentes).toContain('Juan')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/anonymize.test.ts`
Expected: FAIL — cannot find module '@/lib/anonymize'

- [ ] **Step 3: Write the implementation**

```ts
// lib/anonymize.ts
// Server-only. Anonimiza lo que se PERSISTE en el historial — las respuestas en vivo
// de la API mantienen datos reales (el doctor los necesita para su ficha). Best-effort
// declarado: menciones que la IA no extrajo pueden quedar (aceptado en el spec).
import type { ExtractedData, PatientData } from './types'

/** Seudónimo determinístico por atención (igual entre corridas): "Paciente 7F3A". */
export function pseudonymFor(atencionId: string): string {
  let h = 5381
  for (let i = 0; i < atencionId.length; i++) {
    h = ((h * 33) ^ atencionId.charCodeAt(i)) >>> 0
  }
  return `Paciente ${h.toString(36).slice(0, 4).toUpperCase()}`
}

// RUT chileno con o sin puntos/guión: 12.345.678-5, 12345678-5, 123456785.
const RUT_RE = /\b\d{1,2}\.?\d{3}\.?\d{3}\s?-?\s?[\dkK]\b/g

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Reemplaza (case-insensitive) los identificadores extraídos + cualquier RUT.
 * Identificadores de <3 chars se ignoran para no romper palabras comunes.
 */
export function scrubText(
  text: string,
  patient: PatientData | null | undefined,
  pseudonym: string
): string {
  let out = text
  const values = [patient?.name, patient?.lastName, patient?.document].filter(
    (v): v is string => typeof v === 'string' && v.trim().length >= 3
  )
  for (const v of values) {
    out = out.replace(new RegExp(escapeRe(v.trim()), 'gi'), pseudonym)
  }
  return out.replace(RUT_RE, 'RUT-OCULTO')
}

/** Copia de la extracción con identificadores reemplazados (solo para persistir). */
export function scrubExtractedData(data: ExtractedData, pseudonym: string): ExtractedData {
  const sections = { ...data.clinicalSections }
  for (const k of Object.keys(sections) as (keyof typeof sections)[]) {
    const v = sections[k]
    if (typeof v === 'string') sections[k] = scrubText(v, data.patient, pseudonym)
  }
  return {
    patient: { ...data.patient, name: pseudonym, lastName: null, document: null },
    clinicalSections: sections,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/anonymize.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/anonymize.ts __tests__/anonymize.test.ts
git commit -m "feat: anonimización al persistir (seudónimo + scrub de identificadores)"
```

---

### Task 3: `lib/atenciones.ts` — DynamoDB repo

**Files:**
- Create: `lib/atenciones.ts`
- Test: `__tests__/atenciones.test.ts`

Write-safety design (adversarial finding F6): `recordRun` uses an optimistic lock (`ConditionExpression` on `updatedAt`, one retry with fresh state); `attachValidation`/`attachSummary` use `UpdateItem` on their own attribute so they can never clobber `runs`/`transcript` from an in-flight extract.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
// __tests__/atenciones.test.ts
// Repo puro de storage (la anonimización pasa ANTES, en lib/persist-atencion).
// DocumentClient mockeado — sin red ni credenciales, patrón de bedrock.test.ts.
import {
  recordRun,
  attachValidation,
  attachSummary,
  listAtenciones,
  getAtencion,
} from '@/lib/atenciones'
import type { ExtractedData } from '@/lib/types'

const mockSend = jest.fn()

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}))
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  GetCommand: jest.fn((input) => ({ __cmd: 'Get', ...input })),
  PutCommand: jest.fn((input) => ({ __cmd: 'Put', ...input })),
  UpdateCommand: jest.fn((input) => ({ __cmd: 'Update', ...input })),
  QueryCommand: jest.fn((input) => ({ __cmd: 'Query', ...input })),
}))
jest.mock('@vercel/oidc-aws-credentials-provider', () => ({
  awsCredentialsProvider: jest.fn(),
}))

function conditionalError(): Error {
  const err = new Error('The conditional request failed')
  err.name = 'ConditionalCheckFailedException'
  return err
}

const RESULT: ExtractedData = {
  patient: { name: 'Paciente A1B2', lastName: null, age: 45, document: null, docType: 1 },
  clinicalSections: {
    antecedentes: 'gastritis',
    anamnesis: null,
    examenFisico: null,
    diagnostico: 'gastritis aguda',
    plan: 'omeprazol',
  },
}

const RUN_INPUT = {
  transcript: 'dictado ya anonimizado',
  stt: 'transcribe',
  prompt: 'instrucciones',
  engine: 'bedrock',
  model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  result: RESULT,
}

const VALIDATION = {
  consistent: true,
  observations: 'ok',
  prompt: 'prompt de validación',
  engine: 'bedrock',
  model: 'haiku',
  at: '2026-07-10T15:00:00.000Z',
}

const ID = '01JZXA0000000000000000000A'

beforeEach(() => mockSend.mockReset())

describe('recordRun', () => {
  it('creates the record on the first run (Get miss → conditional Put)', async () => {
    mockSend.mockResolvedValueOnce({}) // Get: no Item
    mockSend.mockResolvedValueOnce({}) // Put
    await recordRun(ID, 'Paciente A1B2', RUN_INPUT)

    const put = mockSend.mock.calls[1][0]
    expect(put.__cmd).toBe('Put')
    expect(put.ConditionExpression).toBe('attribute_not_exists(pk)')
    expect(put.Item.pk).toBe('ATENCION')
    expect(put.Item.sk).toBe(ID)
    expect(put.Item.pseudonym).toBe('Paciente A1B2')
    expect(put.Item.runs).toHaveLength(1)
    expect(put.Item.runs[0].stt).toBe('transcribe')
    expect(put.Item.runs[0].transcriptChars).toBe(RUN_INPUT.transcript.length)
    expect(put.Item.runsCount).toBe(1)
    expect(put.Item.lastDiagnostico).toBe('gastritis aguda')
    expect(put.Item.createdAt).toBe(put.Item.updatedAt)
  })

  it('appends runs with a rolling window of 20 and keeps validation/summary', async () => {
    const existingRuns = Array.from({ length: 20 }, (_, i) => ({ ...RUN_INPUT, at: `t${i}` }))
    mockSend.mockResolvedValueOnce({
      Item: {
        pk: 'ATENCION', sk: ID, createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: 'x', pseudonym: 'Paciente A1B2', transcript: 'viejo',
        runs: existingRuns, runsCount: 20, lastDiagnostico: 'previo',
        validation: VALIDATION,
      },
    })
    mockSend.mockResolvedValueOnce({})
    await recordRun(ID, 'Paciente A1B2', RUN_INPUT)

    const put = mockSend.mock.calls[1][0]
    expect(put.ConditionExpression).toBe('updatedAt = :prev')
    expect(put.ExpressionAttributeValues).toEqual({ ':prev': 'x' })
    expect(put.Item.runs).toHaveLength(20) // window, not 21
    expect(put.Item.runsCount).toBe(21) // el contador sí sigue subiendo
    expect(put.Item.createdAt).toBe('2026-07-10T00:00:00.000Z')
    expect(put.Item.validation).toEqual(VALIDATION)
    expect(put.Item.transcript).toBe('dictado ya anonimizado') // el último gana
  })

  it('retries ONCE with fresh state on a conditional conflict', async () => {
    mockSend.mockResolvedValueOnce({}) // Get 1
    mockSend.mockRejectedValueOnce(conditionalError()) // Put 1 → conflicto
    mockSend.mockResolvedValueOnce({
      Item: {
        pk: 'ATENCION', sk: ID, createdAt: 'c', updatedAt: 'fresh',
        pseudonym: 'P', transcript: 't', runs: [], runsCount: 1, lastDiagnostico: null,
      },
    }) // Get 2 (estado fresco)
    mockSend.mockResolvedValueOnce({}) // Put 2 OK
    await recordRun(ID, 'P', RUN_INPUT)
    expect(mockSend).toHaveBeenCalledTimes(4)
    const put2 = mockSend.mock.calls[3][0]
    expect(put2.ExpressionAttributeValues).toEqual({ ':prev': 'fresh' })
    expect(put2.Item.runsCount).toBe(2)
  })

  it('gives up (throws) on a second consecutive conflict', async () => {
    mockSend.mockResolvedValueOnce({})
    mockSend.mockRejectedValueOnce(conditionalError())
    mockSend.mockResolvedValueOnce({})
    mockSend.mockRejectedValueOnce(conditionalError())
    await expect(recordRun(ID, 'P', RUN_INPUT)).rejects.toThrow()
  })

  it('truncates huge transcripts (guarda de 400KB por item)', async () => {
    mockSend.mockResolvedValueOnce({})
    mockSend.mockResolvedValueOnce({})
    await recordRun(ID, 'P', { ...RUN_INPUT, transcript: 'x'.repeat(150_000) })
    const put = mockSend.mock.calls[1][0]
    expect(put.Item.transcript.length).toBeLessThan(101_000)
    expect(put.Item.transcript).toContain('[transcript truncado]')
    expect(put.Item.runs[0].transcriptChars).toBe(150_000) // largo REAL procesado
  })
})

describe('attachValidation / attachSummary', () => {
  it('returns false when the record does not exist (condición attribute_exists)', async () => {
    mockSend.mockRejectedValueOnce(conditionalError())
    await expect(attachValidation(ID, VALIDATION)).resolves.toBe(false)
  })

  it('sets validation via UpdateItem on its own attribute (no full-item Put)', async () => {
    mockSend.mockResolvedValueOnce({})
    const ok = await attachValidation(ID, VALIDATION)
    expect(ok).toBe(true)
    const upd = mockSend.mock.calls[0][0]
    expect(upd.__cmd).toBe('Update')
    expect(upd.UpdateExpression).toBe('SET validation = :v, updatedAt = :u')
    expect(upd.ConditionExpression).toBe('attribute_exists(pk)')
    expect(upd.ExpressionAttributeValues).toEqual({ ':v': VALIDATION, ':u': VALIDATION.at })
  })

  it('sets summary the same way', async () => {
    mockSend.mockResolvedValueOnce({})
    const summary = {
      sections: { diagnostico: 'ok' },
      prompt: 'prompt de resumen',
      engine: 'openai',
      model: 'gpt-4o-mini',
      at: 't3',
    }
    const ok = await attachSummary(ID, summary)
    expect(ok).toBe(true)
    const upd = mockSend.mock.calls[0][0]
    expect(upd.UpdateExpression).toBe('SET summary = :s, updatedAt = :u')
    expect(upd.ExpressionAttributeValues).toEqual({ ':s': summary, ':u': 't3' })
  })
})

describe('listAtenciones', () => {
  it('queries newest-first (no Scan) and maps light list items', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          sk: ID, createdAt: 'c', updatedAt: 'u', pseudonym: 'Paciente A1B2',
          runsCount: 3, lastDiagnostico: 'gastritis',
          validation: { consistent: true }, // presente → hasValidation
        },
      ],
      LastEvaluatedKey: { pk: 'ATENCION', sk: ID },
    })
    const { items, nextToken } = await listAtenciones(10)
    const query = mockSend.mock.calls[0][0]
    expect(query.__cmd).toBe('Query')
    expect(query.ScanIndexForward).toBe(false)
    expect(query.Limit).toBe(10)
    expect(items[0]).toEqual({
      id: ID, createdAt: 'c', updatedAt: 'u', pseudonym: 'Paciente A1B2',
      runsCount: 3, lastDiagnostico: 'gastritis', hasValidation: true, hasSummary: false,
    })
    expect(nextToken).toBe(ID)
  })

  it('passes the cursor as ExclusiveStartKey', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] })
    await listAtenciones(10, ID)
    expect(mockSend.mock.calls[0][0].ExclusiveStartKey).toEqual({ pk: 'ATENCION', sk: ID })
  })
})

describe('getAtencion', () => {
  it('returns null on miss', async () => {
    mockSend.mockResolvedValueOnce({})
    await expect(getAtencion(ID)).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/atenciones.test.ts`
Expected: FAIL — cannot find module '@/lib/atenciones'

- [ ] **Step 3: Write the implementation**

```ts
// lib/atenciones.ts
// Server-only. Repo DynamoDB del historial de atenciones. Partición lógica única
// (volumen POC) + sort key ULID → lista newest-first con UN Query, sin Scan
// (invariante del proyecto). La anonimización ocurre antes, en lib/persist-atencion.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'
import type { ExtractedData } from './types'

const REGION = process.env.AWS_REGION || 'us-east-1'
const TABLE = process.env.ATENCIONES_TABLE || 'medconsult-poc-atenciones'
const PK = 'ATENCION'
// Guardas del límite de 400KB por item: ventana de corridas + transcript truncado.
const MAX_RUNS = 20
const MAX_TRANSCRIPT_CHARS = 100_000

export interface AtencionRun {
  at: string
  stt: string // sistema de dictado: 'openai-realtime' | 'transcribe' | 'texto'
  engine: string // IA de extracción: 'openai' | 'bedrock'
  model: string
  prompt: string // string exacto enviado (el carril Bedrock incluye la forma JSON)
  transcriptChars: number // cuántos caracteres del dictado procesó ESTA corrida
  result: ExtractedData
}

export interface AtencionValidation {
  consistent: boolean
  observations: string
  prompt: string
  engine: string
  model: string
  at: string
}

export interface AtencionSummary {
  sections: Record<string, string>
  prompt: string
  engine: string
  model: string
  at: string
}

export interface Atencion {
  pk: string
  sk: string
  createdAt: string
  updatedAt: string
  pseudonym: string
  transcript: string
  runs: AtencionRun[]
  runsCount: number
  lastDiagnostico: string | null
  validation?: AtencionValidation
  summary?: AtencionSummary
}

export interface AtencionListItem {
  id: string
  createdAt: string
  updatedAt: string
  pseudonym: string
  runsCount: number
  lastDiagnostico: string | null
  hasValidation: boolean
  hasSummary: boolean
}

let cachedClient: DynamoDBDocumentClient | null = null
function getClient(): DynamoDBDocumentClient {
  if (!cachedClient) {
    const base = new DynamoDBClient({
      region: REGION,
      // On Vercel: scoped role via OIDC (no static key). Locally: SSO / default chain.
      ...(process.env.AWS_ROLE_ARN
        ? { credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }) }
        : {}),
    })
    cachedClient = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true },
    })
  }
  return cachedClient
}

function isConditionalFail(err: unknown): boolean {
  return err instanceof Error && err.name === 'ConditionalCheckFailedException'
}

function truncateTranscript(text: string): string {
  return text.length > MAX_TRANSCRIPT_CHARS
    ? text.slice(0, MAX_TRANSCRIPT_CHARS) + '\n…[transcript truncado]'
    : text
}

export async function getAtencion(id: string): Promise<Atencion | null> {
  const res = await getClient().send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK, sk: id } })
  )
  return (res.Item as Atencion | undefined) ?? null
}

/**
 * Agrega una corrida de extracción (crea el registro en la primera). Ventana
 * rodante de MAX_RUNS: el dictado en vivo dispara extracciones cada pausa de 2s,
 * así que se conserva la cola (que incluye el estado final tras el flush).
 * Lock optimista: si otra corrida escribió entre el Get y el Put (extract en
 * vuelo + botón), reintenta UNA vez con estado fresco; a la segunda lanza y la
 * capa best-effort lo reporta como saved:false.
 */
export async function recordRun(
  id: string,
  pseudonym: string,
  input: {
    transcript: string
    stt: string
    prompt: string
    engine: string
    model: string
    result: ExtractedData
  }
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const now = new Date().toISOString()
    const existing = await getAtencion(id)
    const runs = [
      ...(existing?.runs ?? []),
      {
        at: now,
        stt: input.stt,
        engine: input.engine,
        model: input.model,
        prompt: input.prompt,
        transcriptChars: input.transcript.length,
        result: input.result,
      },
    ].slice(-MAX_RUNS)

    const item: Atencion = {
      pk: PK,
      sk: id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      pseudonym,
      transcript: truncateTranscript(input.transcript),
      runs,
      runsCount: (existing?.runsCount ?? 0) + 1,
      // Denormalizado para que la lista no lea los runs completos.
      lastDiagnostico: input.result.clinicalSections?.diagnostico ?? null,
      ...(existing?.validation ? { validation: existing.validation } : {}),
      ...(existing?.summary ? { summary: existing.summary } : {}),
    }
    try {
      await getClient().send(
        new PutCommand({
          TableName: TABLE,
          Item: item,
          ...(existing
            ? {
                ConditionExpression: 'updatedAt = :prev',
                ExpressionAttributeValues: { ':prev': existing.updatedAt },
              }
            : { ConditionExpression: 'attribute_not_exists(pk)' }),
        })
      )
      return
    } catch (err) {
      if (!isConditionalFail(err) || attempt === 1) throw err
    }
  }
}

/**
 * Setea la validación con UpdateItem sobre SU atributo — no puede pisar
 * runs/transcript de un extract en vuelo. false si aún no existe el registro.
 */
export async function attachValidation(
  id: string,
  validation: AtencionValidation
): Promise<boolean> {
  try {
    await getClient().send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk: PK, sk: id },
        UpdateExpression: 'SET validation = :v, updatedAt = :u',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeValues: { ':v': validation, ':u': validation.at },
      })
    )
    return true
  } catch (err) {
    if (isConditionalFail(err)) return false
    throw err
  }
}

/** Setea el resumen (mismo mecanismo que la validación). */
export async function attachSummary(id: string, summary: AtencionSummary): Promise<boolean> {
  try {
    await getClient().send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk: PK, sk: id },
        UpdateExpression: 'SET summary = :s, updatedAt = :u',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeValues: { ':s': summary, ':u': summary.at },
      })
    )
    return true
  } catch (err) {
    if (isConditionalFail(err)) return false
    throw err
  }
}

/** Lista newest-first con cursor opt-in (Limit es la palanca de lectura, no Scan). */
export async function listAtenciones(
  limit = 50,
  cursor?: string
): Promise<{ items: AtencionListItem[]; nextToken?: string }> {
  const res = await getClient().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': PK },
      ScanIndexForward: false,
      Limit: limit,
      ...(cursor ? { ExclusiveStartKey: { pk: PK, sk: cursor } } : {}),
    })
  )
  const items: AtencionListItem[] = (res.Items ?? []).map((it) => {
    const a = it as Atencion
    return {
      id: a.sk,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      pseudonym: a.pseudonym,
      runsCount: a.runsCount ?? 0,
      lastDiagnostico: a.lastDiagnostico ?? null,
      hasValidation: Boolean(a.validation),
      hasSummary: Boolean(a.summary),
    }
  })
  const lastKey = res.LastEvaluatedKey as { sk?: string } | undefined
  return { items, ...(lastKey?.sk ? { nextToken: lastKey.sk } : {}) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/atenciones.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/atenciones.ts __tests__/atenciones.test.ts
git commit -m "feat: repo DynamoDB de atenciones (lock optimista en runs, UpdateItem en validación/resumen)"
```

---

### Task 4: `lib/persist-atencion.ts` — best-effort orchestration

**Files:**
- Create: `lib/persist-atencion.ts`
- Test: `__tests__/persist-atencion.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
// __tests__/persist-atencion.test.ts
// La capa best-effort: valida el id, anonimiza y NUNCA lanza (un fallo del
// historial no puede romper la respuesta clínica). Repo mockeado.
import { persistExtractRun, persistValidation, persistSummary } from '@/lib/persist-atencion'
import { recordRun, attachValidation, attachSummary } from '@/lib/atenciones'
import type { ExtractedData } from '@/lib/types'

jest.mock('@/lib/atenciones', () => ({
  recordRun: jest.fn(),
  attachValidation: jest.fn().mockResolvedValue(true),
  attachSummary: jest.fn().mockResolvedValue(true),
}))

const ID = '01JZXA0000000000000000000A'
const META = { prompt: 'plantilla con $CONSULTATION_DATA', engine: 'bedrock', model: 'haiku' }
const DATA: ExtractedData = {
  patient: { name: 'Juan', lastName: 'Pérez', age: 45, document: '12345678-5', docType: 1 },
  clinicalSections: {
    antecedentes: 'Juan Pérez con gastritis',
    anamnesis: null,
    examenFisico: null,
    diagnostico: 'gastritis',
    plan: null,
  },
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('persistExtractRun', () => {
  const INPUT = {
    transcript: 'Paciente Juan Pérez, RUT 12.345.678-5, con dolor',
    stt: 'openai-realtime',
    prompt: 'instrucciones',
    engine: 'bedrock',
    model: 'haiku',
    result: DATA,
  }

  it('skips silently without a valid ULID', async () => {
    await expect(persistExtractRun(undefined, INPUT)).resolves.toBe(false)
    await expect(persistExtractRun('garbage', INPUT)).resolves.toBe(false)
    expect(recordRun).not.toHaveBeenCalled()
  })

  it('anonymizes transcript and result before persisting; stt/prompt pass through', async () => {
    await expect(persistExtractRun(ID, INPUT)).resolves.toBe(true)
    const [id, pseudonym, stored] = (recordRun as jest.Mock).mock.calls[0]
    expect(id).toBe(ID)
    expect(pseudonym).toMatch(/^Paciente /)
    expect(stored.transcript).not.toMatch(/juan|pérez/i)
    expect(stored.transcript).not.toContain('12.345.678-5')
    expect(stored.result.patient.name).toBe(pseudonym)
    expect(stored.result.patient.document).toBeNull()
    expect(stored.stt).toBe('openai-realtime')
    expect(stored.prompt).toBe('instrucciones')
  })

  it('returns false (never throws) when the repo fails, logging PII-safe', async () => {
    ;(recordRun as jest.Mock).mockRejectedValueOnce(new Error('ddb down'))
    await expect(persistExtractRun(ID, INPUT)).resolves.toBe(false)
    const logged = JSON.stringify((console.error as jest.Mock).mock.calls)
    expect(logged).not.toContain('Juan') // nunca contenido clínico en logs
    expect(logged).toContain('ddb down')
  })
})

describe('persistValidation', () => {
  it('scrubs observations and stores prompt/engine/model + at', async () => {
    const ok = await persistValidation(
      ID,
      DATA.patient,
      { consistent: false, observations: 'El plan de Juan Pérez omite la alergia' },
      META
    )
    expect(ok).toBe(true)
    const [, stored] = (attachValidation as jest.Mock).mock.calls[0]
    expect(stored.observations).not.toMatch(/juan|pérez/i)
    expect(stored.consistent).toBe(false)
    expect(stored.prompt).toBe(META.prompt)
    expect(stored.engine).toBe('bedrock')
    expect(stored.model).toBe('haiku')
    expect(typeof stored.at).toBe('string')
  })

  it('skips without valid ULID', async () => {
    await expect(
      persistValidation('nope', DATA.patient, { consistent: true, observations: '' }, META)
    ).resolves.toBe(false)
    expect(attachValidation).not.toHaveBeenCalled()
  })
})

describe('persistSummary', () => {
  it('scrubs every section and stores prompt/engine/model', async () => {
    const ok = await persistSummary(
      ID,
      DATA.patient,
      { antecedentes: 'Juan con gastritis', diagnostico: 'gastritis' },
      { ...META, engine: 'openai', model: 'gpt-4o-mini' }
    )
    expect(ok).toBe(true)
    const [, stored] = (attachSummary as jest.Mock).mock.calls[0]
    expect(stored.sections.antecedentes).not.toMatch(/juan/i)
    expect(stored.sections.diagnostico).toBe('gastritis')
    expect(stored.engine).toBe('openai')
    expect(stored.model).toBe('gpt-4o-mini')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/persist-atencion.test.ts`
Expected: FAIL — cannot find module '@/lib/persist-atencion'

- [ ] **Step 3: Write the implementation**

```ts
// lib/persist-atencion.ts
// Server-only. Capa best-effort entre las rutas API y el repo: valida el id,
// anonimiza (spec §Anonimización) y NUNCA lanza — un fallo del historial no
// puede romper la respuesta clínica. Logs PII-safe: ids y tamaños, nunca contenido.
import { isUlid } from './ulid'
import { pseudonymFor, scrubText, scrubExtractedData } from './anonymize'
import { recordRun, attachValidation, attachSummary } from './atenciones'
import type { ExtractedData, PatientData } from './types'

/** Prompt/engine/modelo con que corrió el paso — parte del contrato de visibilidad. */
export interface RunMeta {
  prompt: string
  engine: string
  model: string
}

function logFail(op: string, atencionId: string, err: unknown, extra?: Record<string, unknown>) {
  console.error(`${op} failed:`, {
    atencionId,
    ...extra,
    message: err instanceof Error ? err.message : String(err),
  })
}

export async function persistExtractRun(
  atencionId: unknown,
  input: {
    transcript: string
    stt: string
    prompt: string
    engine: string
    model: string
    result: ExtractedData
  }
): Promise<boolean> {
  if (!isUlid(atencionId)) return false
  try {
    const pseudonym = pseudonymFor(atencionId)
    await recordRun(atencionId, pseudonym, {
      transcript: scrubText(input.transcript, input.result.patient, pseudonym),
      stt: input.stt,
      prompt: input.prompt,
      engine: input.engine,
      model: input.model,
      result: scrubExtractedData(input.result, pseudonym),
    })
    return true
  } catch (err) {
    logFail('persistExtractRun', atencionId, err, { transcriptLength: input.transcript.length })
    return false
  }
}

export async function persistValidation(
  atencionId: unknown,
  patient: PatientData | null | undefined,
  validation: { consistent: boolean; observations: string },
  meta: RunMeta
): Promise<boolean> {
  if (!isUlid(atencionId)) return false
  try {
    const pseudonym = pseudonymFor(atencionId)
    return await attachValidation(atencionId, {
      consistent: validation.consistent,
      observations: scrubText(validation.observations, patient, pseudonym),
      prompt: meta.prompt,
      engine: meta.engine,
      model: meta.model,
      at: new Date().toISOString(),
    })
  } catch (err) {
    logFail('persistValidation', atencionId, err)
    return false
  }
}

export async function persistSummary(
  atencionId: unknown,
  patient: PatientData | null | undefined,
  sections: Record<string, string>,
  meta: RunMeta
): Promise<boolean> {
  if (!isUlid(atencionId)) return false
  try {
    const pseudonym = pseudonymFor(atencionId)
    const scrubbed: Record<string, string> = {}
    for (const [k, v] of Object.entries(sections)) {
      scrubbed[k] = scrubText(v, patient, pseudonym)
    }
    return await attachSummary(atencionId, {
      sections: scrubbed,
      prompt: meta.prompt,
      engine: meta.engine,
      model: meta.model,
      at: new Date().toISOString(),
    })
  } catch (err) {
    logFail('persistSummary', atencionId, err)
    return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/persist-atencion.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/persist-atencion.ts __tests__/persist-atencion.test.ts
git commit -m "feat: persistencia best-effort de atenciones (anonimiza; guarda stt y prompt/engine/model por paso)"
```

---

### Task 5: Thread `atencionId` (+ stt + meta) through the 3 existing API routes

**Files:**
- Modify: `app/api/extract/route.ts` (both lanes), `app/api/validate/route.ts`, `app/api/summarize/route.ts`
- Test: `__tests__/api-atencion-persist.test.ts`

Contract: `atencionId` optional in the POST body (extract also takes optional `stt`). When present, the route persists after computing the clinical response and sets the header `x-atencion-saved: 'true' | 'false'`. Response **bodies do not change** (header instead of a body flag — deliberate deviation from the spec's first draft, documented in spec v2: keeps the raw JSON the doctor sees pristine). Without `atencionId`, behavior is byte-identical to today (no header).

Persisted prompts: the exact string sent for the Bedrock extract lane (`${instructions}\n\n${JSON_SHAPE}`); the editable template (`instructions`) for the OpenAI lane (schema is enforced via `json_schema`, not prompt text) and for validate/summarize (the `$CONSULTATION_DATA` marker stays un-injected — the injected data is already visible as the extraction in the same record, and injecting it would duplicate PII).

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
// __tests__/api-atencion-persist.test.ts
// Contrato aditivo: atencionId opcional → header x-atencion-saved; el body no cambia.
import { NextRequest } from 'next/server'
import { POST as extractPOST } from '@/app/api/extract/route'
import { POST as validatePOST } from '@/app/api/validate/route'
import { POST as summarizePOST } from '@/app/api/summarize/route'
import { persistExtractRun, persistValidation, persistSummary } from '@/lib/persist-atencion'

jest.mock('@/lib/bedrock', () => ({
  invokeClaudeJson: jest.fn().mockResolvedValue({
    patient: { name: 'Juan', lastName: null, age: 45, document: null, docType: 1 },
    clinicalSections: {
      antecedentes: null, anamnesis: null, examenFisico: null,
      diagnostico: 'gastritis', plan: null,
    },
  }),
  getBedrockModelId: jest.fn(() => 'us.anthropic.claude-haiku-4-5-20251001-v1:0'),
}))
jest.mock('@/lib/server-openai', () => ({
  buildSections: jest.fn(() => ({ antecedentes: 'a', planTrabajo: 'p' })),
  callOpenAIJson: jest.fn(),
}))
jest.mock('@/lib/persist-atencion', () => ({
  persistExtractRun: jest.fn().mockResolvedValue(true),
  persistValidation: jest.fn().mockResolvedValue(true),
  persistSummary: jest.fn().mockResolvedValue(true),
}))

const ID = '01JZXA0000000000000000000A'
const DATA = {
  patient: { name: 'Juan', lastName: null, age: 45, document: null, docType: 1 },
  clinicalSections: { antecedentes: 'a', anamnesis: null, examenFisico: null, diagnostico: null, plan: 'p' },
}

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/extract (bedrock lane)', () => {
  const BODY = { transcript: 'dictado', engine: 'bedrock', atencionId: ID, stt: 'transcribe' }

  it('persists (with stt and the EXACT prompt sent) and reports x-atencion-saved: true, body unchanged', async () => {
    const res = await extractPOST(post('/api/extract', BODY))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-atencion-saved')).toBe('true')
    const json = await res.json()
    expect(json.patient.name).toBe('Juan') // respuesta en vivo con datos reales
    expect(json).not.toHaveProperty('saved') // sin campos nuevos en el body
    const [id, input] = (persistExtractRun as jest.Mock).mock.calls[0]
    expect(id).toBe(ID)
    expect(input.transcript).toBe('dictado')
    expect(input.engine).toBe('bedrock')
    expect(input.stt).toBe('transcribe')
    expect(input.prompt).toContain('JSON') // carril Bedrock: instrucciones + forma JSON exacta
  })

  it('defaults stt to "texto" when the client did not send it', async () => {
    await extractPOST(post('/api/extract', { transcript: 'd', engine: 'bedrock', atencionId: ID }))
    expect((persistExtractRun as jest.Mock).mock.calls[0][1].stt).toBe('texto')
  })

  it('reports x-atencion-saved: false when persistence fails', async () => {
    ;(persistExtractRun as jest.Mock).mockResolvedValueOnce(false)
    const res = await extractPOST(post('/api/extract', BODY))
    expect(res.status).toBe(200) // el flujo clínico nunca se bloquea
    expect(res.headers.get('x-atencion-saved')).toBe('false')
  })

  it('omits the header entirely without atencionId (no-breaking)', async () => {
    const res = await extractPOST(post('/api/extract', { transcript: 'dictado', engine: 'bedrock' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-atencion-saved')).toBeNull()
    expect(persistExtractRun).not.toHaveBeenCalled()
  })
})

describe('POST /api/validate', () => {
  it('persists validation WITH its prompt/engine/model', async () => {
    const { invokeClaudeJson } = jest.requireMock('@/lib/bedrock')
    invokeClaudeJson.mockResolvedValueOnce({ consistent: true, observations: 'ok' })
    const res = await validatePOST(
      post('/api/validate', { data: DATA, engine: 'bedrock', model: 'haiku', atencionId: ID })
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('x-atencion-saved')).toBe('true')
    const [id, patient, payload, meta] = (persistValidation as jest.Mock).mock.calls[0]
    expect(id).toBe(ID)
    expect(patient).toEqual(expect.objectContaining({ name: 'Juan' }))
    expect(payload).toEqual({ consistent: true, observations: 'ok' })
    expect(meta).toEqual({ prompt: expect.any(String), engine: 'bedrock', model: 'haiku' })
  })
})

describe('POST /api/summarize', () => {
  it('persists summary WITH its prompt/engine/model', async () => {
    const { invokeClaudeJson } = jest.requireMock('@/lib/bedrock')
    invokeClaudeJson.mockResolvedValueOnce({ diagnostico: 'dx' })
    const res = await summarizePOST(
      post('/api/summarize', { data: DATA, engine: 'bedrock', model: 'haiku', atencionId: ID })
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('x-atencion-saved')).toBe('true')
    const [id, , sections, meta] = (persistSummary as jest.Mock).mock.calls[0]
    expect(id).toBe(ID)
    expect(sections).toEqual(expect.objectContaining({ diagnostico: 'dx' }))
    expect(meta).toEqual({ prompt: expect.any(String), engine: 'bedrock', model: 'haiku' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api-atencion-persist.test.ts`
Expected: FAIL — header `x-atencion-saved` is null / persist mocks not called

- [ ] **Step 3: Modify `app/api/extract/route.ts`**

Add imports at the top:

```ts
import { invokeClaudeJson, getBedrockModelId } from '@/lib/bedrock'
import { persistExtractRun } from '@/lib/persist-atencion'
import type { ExtractedData } from '@/lib/types'
```
(the first line replaces the existing `invokeClaudeJson`-only import)

Change the body destructuring (line 16):

```ts
  const { transcript, prompt, engine, model, atencionId, stt } = await req.json()
```

Add helpers right after the `instructions` computation (after line 31):

```ts
  // Header aditivo del historial: solo cuando el cliente mandó atencionId.
  const savedHeaders = (saved: boolean | null): HeadersInit | undefined =>
    saved === null ? undefined : { 'x-atencion-saved': String(saved) }
  // Sistema de dictado que produjo el transcript (visibilidad del historial).
  const sttUsed = typeof stt === 'string' && stt.trim().length > 0 ? stt : 'texto'
```

Bedrock lane — replace `return NextResponse.json(result)` (line 44) with:

```ts
      const saved =
        atencionId === undefined
          ? null
          : await persistExtractRun(atencionId, {
              transcript,
              stt: sttUsed,
              // El string EXACTO que recibió el modelo (instrucciones + forma JSON).
              prompt: `${instructions}\n\n${JSON_SHAPE}`,
              engine: 'bedrock',
              model: bedrockModel ?? getBedrockModelId(),
              result: result as ExtractedData,
            })
      return NextResponse.json(result, { headers: savedHeaders(saved) })
```

OpenAI lane — replace `return NextResponse.json(extracted)` (line 124) with:

```ts
    const saved =
      atencionId === undefined
        ? null
        : await persistExtractRun(atencionId, {
            transcript,
            stt: sttUsed,
            // Carril OpenAI: el JSON se fuerza vía json_schema, no vía prompt.
            prompt: instructions,
            engine: 'openai',
            model: openaiModel,
            result: extracted as ExtractedData,
          })
    return NextResponse.json(extracted, { headers: savedHeaders(saved) })
```

- [ ] **Step 4: Modify `app/api/validate/route.ts`**

Add imports:

```ts
import { persistValidation } from '@/lib/persist-atencion'
import { getBedrockModelId } from '@/lib/bedrock'
```

Extend the body type (line 24):

```ts
    const { data, prompt, engine, model, atencionId } = (await req.json()) as {
      data: ExtractedData
      prompt?: string
      engine?: string
      model?: string
      atencionId?: string
    }
```

Replace the final `return NextResponse.json({...})` (lines 52-55) with:

```ts
    const payload = {
      consistent: result.consistent === true,
      observations: (result.observations as string) || '',
    }
    const saved =
      atencionId === undefined
        ? null
        : await persistValidation(atencionId, data.patient, payload, {
            // La plantilla editable (con $CONSULTATION_DATA): los datos inyectados ya
            // son visibles como extracción en el mismo registro — no se duplican.
            prompt: instructions,
            engine: engine === 'bedrock' ? 'bedrock' : 'openai',
            model: useModel ?? (engine === 'bedrock' ? getBedrockModelId() : 'gpt-4o-mini'),
          })
    return NextResponse.json(payload, {
      ...(saved === null ? {} : { headers: { 'x-atencion-saved': String(saved) } }),
    })
```

- [ ] **Step 5: Modify `app/api/summarize/route.ts`** (same pattern)

Add imports `persistSummary` + `getBedrockModelId`; add `atencionId?: string` to the body type; replace the final `return NextResponse.json({...})` (lines 48-54) with:

```ts
    const payload = {
      antecedentes: (result.antecedentes as string) || sections.antecedentes || '',
      motivoConsulta: (result.motivoConsulta as string) || sections.motivoConsulta || '',
      examenFisico: (result.examenFisico as string) || sections.examenFisico || '',
      diagnostico: (result.diagnostico as string) || sections.diagnostico || '',
      planTrabajo: (result.planTrabajo as string) || sections.planTrabajo || '',
    }
    const saved =
      atencionId === undefined
        ? null
        : await persistSummary(atencionId, data.patient, payload, {
            prompt: instructions,
            engine: engine === 'bedrock' ? 'bedrock' : 'openai',
            model: useModel ?? (engine === 'bedrock' ? getBedrockModelId() : 'gpt-4o-mini'),
          })
    return NextResponse.json(payload, {
      ...(saved === null ? {} : { headers: { 'x-atencion-saved': String(saved) } }),
    })
```

- [ ] **Step 6: Run the test suite**

Run: `npx jest __tests__/api-atencion-persist.test.ts && npm test`
Expected: new file PASS (7 tests); full suite green (existing bedrock/extraction tests unaffected).

- [ ] **Step 7: Commit**

```bash
git add app/api/extract/route.ts app/api/validate/route.ts app/api/summarize/route.ts __tests__/api-atencion-persist.test.ts
git commit -m "feat: rutas extract/validate/summarize persisten la atención con stt y prompt/engine/model por paso"
```

---

### Task 6: Read APIs — `GET /api/atenciones` + `GET /api/atenciones/[id]`

**Files:**
- Create: `app/api/atenciones/route.ts`
- Create: `app/api/atenciones/[id]/route.ts`
- Test: `__tests__/api-atenciones-read.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
// __tests__/api-atenciones-read.test.ts
import { NextRequest } from 'next/server'
import { GET as listGET } from '@/app/api/atenciones/route'
import { GET as detailGET } from '@/app/api/atenciones/[id]/route'
import { listAtenciones, getAtencion } from '@/lib/atenciones'

jest.mock('@/lib/atenciones', () => ({
  listAtenciones: jest.fn().mockResolvedValue({ items: [], nextToken: undefined }),
  getAtencion: jest.fn().mockResolvedValue(null),
}))

const ID = '01JZXA0000000000000000000A'

beforeEach(() => jest.clearAllMocks())

describe('GET /api/atenciones', () => {
  it('returns the list with clamped limit and optional cursor', async () => {
    const res = await listGET(new NextRequest(`http://localhost/api/atenciones?limit=500&cursor=${ID}`))
    expect(res.status).toBe(200)
    expect(listAtenciones).toHaveBeenCalledWith(100, ID) // 500 → clamp 100
    await expect(res.json()).resolves.toEqual({ atenciones: [] })
  })

  it('defaults to limit 50', async () => {
    await listGET(new NextRequest('http://localhost/api/atenciones'))
    expect(listAtenciones).toHaveBeenCalledWith(50, undefined)
  })

  it('500s with a safe message when the repo fails', async () => {
    ;(listAtenciones as jest.Mock).mockRejectedValueOnce(new Error('ddb down'))
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const res = await listGET(new NextRequest('http://localhost/api/atenciones'))
    expect(res.status).toBe(500)
    jest.restoreAllMocks()
  })
})

describe('GET /api/atenciones/[id]', () => {
  it('400s on a non-ULID id', async () => {
    const res = await detailGET(new NextRequest('http://localhost/api/atenciones/nope'), {
      params: Promise.resolve({ id: 'nope' }),
    })
    expect(res.status).toBe(400)
    expect(getAtencion).not.toHaveBeenCalled()
  })

  it('404s when missing', async () => {
    const res = await detailGET(new NextRequest(`http://localhost/api/atenciones/${ID}`), {
      params: Promise.resolve({ id: ID }),
    })
    expect(res.status).toBe(404)
  })

  it('returns the record', async () => {
    ;(getAtencion as jest.Mock).mockResolvedValueOnce({ pk: 'ATENCION', sk: ID, runs: [] })
    const res = await detailGET(new NextRequest(`http://localhost/api/atenciones/${ID}`), {
      params: Promise.resolve({ id: ID }),
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ sk: ID })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api-atenciones-read.test.ts`
Expected: FAIL — cannot find module '@/app/api/atenciones/route'

- [ ] **Step 3: Write `app/api/atenciones/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { listAtenciones } from '@/lib/atenciones'

/**
 * Lista del historial, newest-first. Proyección liviana (sin runs ni transcript).
 * GET /api/atenciones?limit=50&cursor=<ulid> → { atenciones: [...], nextToken? }
 */
export async function GET(req: NextRequest) {
  try {
    const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? 50)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 50
    const cursor = req.nextUrl.searchParams.get('cursor') ?? undefined
    const { items, nextToken } = await listAtenciones(limit, cursor)
    return NextResponse.json({ atenciones: items, ...(nextToken ? { nextToken } : {}) })
  } catch (error) {
    console.error('GET /api/atenciones error:', error)
    return NextResponse.json({ error: 'No se pudo leer el historial' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Write `app/api/atenciones/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getAtencion } from '@/lib/atenciones'
import { isUlid } from '@/lib/ulid'

/** Detalle completo de una atención (transcript + runs + validación + resumen). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isUlid(id)) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 })
  }
  try {
    const atencion = await getAtencion(id)
    if (!atencion) {
      return NextResponse.json({ error: 'Atención no encontrada' }, { status: 404 })
    }
    return NextResponse.json(atencion)
  } catch (error) {
    console.error('GET /api/atenciones/[id] error:', error)
    return NextResponse.json({ error: 'No se pudo leer la atención' }, { status: 500 })
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/api-atenciones-read.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add app/api/atenciones __tests__/api-atenciones-read.test.ts
git commit -m "feat: APIs de lectura del historial (lista con cursor + detalle)"
```

---

### Task 7: `lib/access-gate.ts` — cookie HMAC + gate decision

**Files:**
- Create: `lib/access-gate.ts`
- Test: `__tests__/access-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/access-gate.test.ts`
Expected: FAIL — cannot find module '@/lib/access-gate'

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/access-gate.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/access-gate.ts __tests__/access-gate.test.ts
git commit -m "feat: gate de acceso (HMAC cookie + decisión pura testeable)"
```

---

### Task 8: `proxy.ts` + `/acceso` page + `POST /api/acceso`

**Files:**
- Create: `proxy.ts` (repo root — Next 16 convention, NOT `middleware.ts`)
- Create: `app/api/acceso/route.ts`
- Create: `app/acceso/page.tsx`
- Modify: `.env.example`

- [ ] **Step 1: Write `proxy.ts`**

```ts
// proxy.ts (Next 16: sucesor de middleware.ts, runtime nodejs).
// Protege TODAS las páginas y APIs detrás del código de acceso — incluidas las
// rutas hoy abiertas (Bedrock, credenciales Transcribe, SSM). Inerte sin env vars.
import { NextRequest, NextResponse } from 'next/server'
import { ACCESS_COOKIE, decideAccess } from '@/lib/access-gate'

export default function proxy(request: NextRequest) {
  const decision = decideAccess(
    request.nextUrl.pathname,
    request.cookies.get(ACCESS_COOKIE)?.value,
    { code: process.env.POC_ACCESS_CODE, secret: process.env.POC_COOKIE_SECRET }
  )
  if (decision === 'unauthorized-api') {
    return NextResponse.json({ error: 'Acceso no autorizado' }, { status: 401 })
  }
  if (decision === 'redirect-acceso') {
    return NextResponse.redirect(new URL('/acceso', request.nextUrl))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 2: Write `app/api/acceso/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { ACCESS_COOKIE, accessToken } from '@/lib/access-gate'

/** Valida el código compartido y setea la cookie de acceso (30 días). */
export async function POST(req: NextRequest) {
  const code = process.env.POC_ACCESS_CODE
  const secret = process.env.POC_COOKIE_SECRET
  if (!code || !secret) {
    return NextResponse.json({ error: 'El acceso no está configurado.' }, { status: 500 })
  }
  const body = (await req.json().catch(() => ({}))) as { code?: unknown }
  if (typeof body.code !== 'string' || body.code !== code) {
    return NextResponse.json({ error: 'Código incorrecto.' }, { status: 401 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: ACCESS_COOKIE,
    value: accessToken(secret, code),
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return res
}
```

- [ ] **Step 3: Write `app/acceso/page.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { LogoMark } from '../components/icons'

/** Pantalla del código de acceso compartido (se entrega por WhatsApp). */
export default function AccesoPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSending(true)
    try {
      const res = await fetch('/api/acceso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error ?? 'No se pudo validar el código.')
        return
      }
      // Recarga completa para que el proxy re-evalúe la cookie en todas las rutas.
      window.location.assign('/prompts')
    } catch {
      setError('No se pudo conectar con el servidor. Intenta de nuevo.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 py-16">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface text-primary">
        <LogoMark className="h-6 w-6" />
      </span>
      <div className="text-center">
        <h1 className="text-xl font-bold text-primary">Acceso al estudio de prompts</h1>
        <p className="mt-1 text-sm text-muted">
          Ingresa el código de acceso que te compartió el equipo.
        </p>
      </div>
      <form onSubmit={submit} className="card w-full space-y-3">
        <label htmlFor="code" className="sr-only">
          Código de acceso
        </label>
        <input
          id="code"
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Código de acceso"
          autoFocus
          className="field"
        />
        <button
          type="submit"
          disabled={sending || code.trim().length === 0}
          className="inline-flex h-11 w-full items-center justify-center rounded-[10px] bg-primary text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-disabled"
        >
          {sending ? 'Validando…' : 'Entrar'}
        </button>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-surface px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Update `.env.example`**

```bash
OPENAI_API_KEY=your_api_key_here
# Código de acceso compartido del POC (gate inerte si falta cualquiera de los dos)
POC_ACCESS_CODE=
POC_COOKIE_SECRET=
# Tabla del historial (default: medconsult-poc-atenciones)
# ATENCIONES_TABLE=
```

- [ ] **Step 5: Verify manually with the dev server**

```bash
# .env.local SIN el código → gate inerte: /prompts abre directo
npm run dev  # visita http://localhost:3000/prompts

# agrega a .env.local:  POC_ACCESS_CODE=test123  y  POC_COOKIE_SECRET=dev-secret
# reinicia; ahora /prompts → redirect a /acceso; /api/models → 401 JSON
# ingresa test123 → cookie → /prompts abre; /api/models responde
```
Expected: exactly that behavior. Also run `npm test` (suite green — gate tests cover the logic; this step verifies the wiring).

- [ ] **Step 6: Commit**

```bash
git add proxy.ts app/api/acceso app/acceso .env.example
git commit -m "feat: código de acceso — proxy.ts cierra páginas y APIs, pantalla /acceso"
```

---

### Task 9: Thread `atencionId` + STT through the client (prompts page + voice lane)

**Files:**
- Modify: `app/prompts/page.tsx`
- Modify: `lib/clinical-extraction.ts` (seed, flush, stt, save-status)
- Modify: `lib/hooks/useVoiceRecording.ts`
- Modify: `lib/types.ts` (`RecordingState.saveWarn`)

Atención lifecycle (spec v2 triggers): new `atencionId` on **mount**, on **sample chip click**, and on **starting a dictation with an empty transcript** ("Empezar de cero" reloads the page → mount). Manual textarea edits do NOT rotate; dictating over an existing transcript **continues** the same atención (the extractor buffer is seeded with it — adversarial finding F4 — so the persisted transcript never loses earlier dictation). On stop, the pending debounced extraction is **flushed** (finding F5) so the last run reflects the full dictation.

- [ ] **Step 1: Modify `lib/types.ts`** — add the save-status flag to `RecordingState`:

```ts
export interface RecordingState {
  isRecording: boolean
  isPaused: boolean
  isFinished: boolean
  liveTranscript: string
  fullTranscript: string
  extractedData: ExtractedData | null
  error: string | null
  isProcessing: boolean
  isExtracting: boolean
  isSubmitting: boolean
  submitResult: SubmitResult | null
  elapsedSeconds: number
  saveWarn: boolean // última corrida de voz no se guardó en el historial
}
```

- [ ] **Step 2: Modify `lib/clinical-extraction.ts`**

Extend the constructor (positional, following the existing getter pattern) and add `seed`/`flush`/stt/save-status:

```ts
  private getAtencionId: (() => string | undefined) | null = null
  private getSttEngine: (() => string | undefined) | null = null
  private onSaveStatus: ((saved: boolean) => void) | null = null

  constructor(
    onExtracted: (data: ExtractedData) => void,
    onExtracting: (isExtracting: boolean) => void,
    getPrompt?: () => string | undefined,
    getEngine?: () => string | undefined,
    getModel?: () => string | undefined,
    getAtencionId?: () => string | undefined,
    getSttEngine?: () => string | undefined,
    onSaveStatus?: (saved: boolean) => void
  ) {
    this.onExtracted = onExtracted
    this.onExtracting = onExtracting
    this.getPrompt = getPrompt ?? null
    this.getEngine = getEngine ?? null
    this.getModel = getModel ?? null
    this.getAtencionId = getAtencionId ?? null
    this.getSttEngine = getSttEngine ?? null
    this.onSaveStatus = onSaveStatus ?? null
  }

  /**
   * Siembra el buffer con el transcript ya acumulado en la página: dictar de nuevo
   * CONTINÚA la misma atención y el transcript persistido no pierde lo anterior.
   */
  seed(text: string): void {
    this.buffer = text.trim()
  }

  /**
   * Dispara YA la extracción pendiente del debounce (se llama al detener la
   * grabación) — sin esto, lo dictado en los últimos 2s nunca se extrae ni persiste.
   */
  flush(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    return this.extract()
  }
```

Make `extract()` non-private (`private async extract()` → `async extract()` — `flush` returns it). In `extract()`, after the `if (model) payload.model = model` line (line 67):

```ts
    const atencionId = this.getAtencionId?.()
    if (atencionId) payload.atencionId = atencionId
    const stt = this.getSttEngine?.()
    if (stt) payload.stt = stt
```

And after the `if (!response.ok)` block, before parsing the body:

```ts
      const savedHeader = response.headers.get('x-atencion-saved')
      if (savedHeader !== null) this.onSaveStatus?.(savedHeader === 'true')
```

Also null the new callbacks in `destroy()`:

```ts
    this.onSaveStatus = null
```

- [ ] **Step 3: Modify `lib/hooks/useVoiceRecording.ts`**

Options type (line 10-16): add two entries:

```ts
  getAtencionId?: () => string | undefined
  onNewDictation?: () => void
```

Refs block (after line 27):

```ts
  const getAtencionIdRef = useRef(options?.getAtencionId)
  getAtencionIdRef.current = options?.getAtencionId
  const onNewDictationRef = useRef(options?.onNewDictation)
  onNewDictationRef.current = options?.onNewDictation
  // Copia del transcript acumulado para sembrar el extractor al re-grabar.
  const fullTranscriptRef = useRef('')
```

Initial state (line 29-42): add `saveWarn: false,`.

In `start()` (line 49), FIRST thing inside the `try` after the setState:

```ts
      // Dictar con el área vacía = atención nueva (spec trigger a); con texto,
      // continúa la misma atención sembrando el buffer con lo ya dictado.
      if (fullTranscriptRef.current.trim() === '') {
        onNewDictationRef.current?.()
      }
```

`ClinicalExtractionService` construction (line 53-63): add the three new arguments and seed:

```ts
      extractionRef.current = new ClinicalExtractionService(
        (data) => {
          setState((prev) => ({ ...prev, extractedData: data }))
        },
        (isExtracting) => {
          setState((prev) => ({ ...prev, isExtracting }))
        },
        () => getPromptRef.current?.(),
        () => getEngineRef.current?.(),
        () => getModelRef.current?.(),
        () => getAtencionIdRef.current?.(),
        () => (getSttRef.current?.() === 'transcribe' ? 'transcribe' : 'openai-realtime'),
        (saved) => setState((prev) => ({ ...prev, saveWarn: !saved }))
      )
      extractionRef.current.seed(fullTranscriptRef.current)
```

In the `onTranscript` callback (lines 72-79), keep the ref in sync:

```ts
        (text) => {
          setState((prev) => {
            const fullTranscript = (prev.fullTranscript + ' ' + text).trim()
            fullTranscriptRef.current = fullTranscript
            return { ...prev, liveTranscript: '', fullTranscript }
          })
          extractionRef.current?.addTranscript(text)
        },
```

In `stop()` (line 122-145): flush BEFORE destroy (after disconnecting the STT client):

```ts
    openaiRef.current?.disconnect()
    openaiRef.current = null

    // Extrae lo pendiente del debounce para que la última corrida refleje el
    // dictado completo, y recién entonces suelta los callbacks.
    await extractionRef.current?.flush()
    extractionRef.current?.destroy()
    extractionRef.current = null
```

In `clear()` (line 229-239): reset the ref and the flag:

```ts
  const clear = useCallback(() => {
    fullTranscriptRef.current = ''
    setState((prev) => ({
      ...prev,
      liveTranscript: '',
      fullTranscript: '',
      extractedData: null,
      isFinished: false,
      submitResult: null,
      elapsedSeconds: 0,
      saveWarn: false,
    }))
  }, [])
```

- [ ] **Step 4: Modify `app/prompts/page.tsx`**

Add import:

```ts
import { ulid } from '@/lib/ulid'
```

Add state next to `const [transcript, setTranscript] = useState('')` (line 111):

```ts
  // Una atención por sesión de dictado: nueva al cargar la página (Empezar de
  // cero recarga), al elegir un ejemplo y al dictar con el área vacía.
  const [atencionId, setAtencionId] = useState(() => ulid())
  const [saveWarn, setSaveWarn] = useState(false)
  // Origen del transcript actual → columna STT del historial.
  const [transcriptOrigin, setTranscriptOrigin] = useState('texto')
```

Keep `transcriptOrigin` in sync with the voice lane — extend the existing sync effect (lines 267-271):

```ts
  useEffect(() => {
    if (voice.state.isRecording) {
      setTranscript((voice.state.fullTranscript + ' ' + voice.state.liveTranscript).trim())
      setTranscriptOrigin(stt === 'transcribe' ? 'transcribe' : 'openai-realtime')
    }
  }, [voice.state.fullTranscript, voice.state.liveTranscript, voice.state.isRecording, stt])
```

Sample chip click (line 597) — replace `onClick={() => setTranscript(s.text)}` with:

```ts
onClick={() => {
  setTranscript(s.text)
  setAtencionId(ulid())
  setTranscriptOrigin('texto')
  setSaveWarn(false)
}}
```

In `runExtraction`, add `atencionId` + `stt` to the body (lines 285-290) and read the header after the ok-check:

```ts
        body: JSON.stringify({
          transcript,
          prompt: prompts.extraction,
          engine,
          model: activeModel,
          atencionId,
          stt: transcriptOrigin,
        }),
```
```ts
      setSaveWarn(res.headers.get('x-atencion-saved') === 'false')
```

Same in `runValidate` (body at line 321) and `runSummarize` (body at line 349): add `atencionId` to the JSON body (no `stt` — solo extract lo necesita) and `setSaveWarn(res.headers.get('x-atencion-saved') === 'false')` after the ok-check.

Pass the new options to the voice hook (lines 254-260):

```ts
  const voice = useVoiceRecording({
    getPrompt: () => prompts.extraction,
    getEngine: () => engine,
    getModel: () => activeModel,
    getStt: () => stt,
    getSttPrompt: () => sttPrompt,
    getAtencionId: () => atencionId,
    onNewDictation: () => {
      setAtencionId(ulid())
      setSaveWarn(false)
    },
  })
```

Render the discreet warning right below the error paragraph (after line 792, same section):

```tsx
            {(saveWarn || voice.state.saveWarn) && (
              <p className="text-xs font-medium text-muted">
                ⚠ La última corrida no se guardó en el historial (la consulta sigue funcionando).
              </p>
            )}
```

- [ ] **Step 5: Verify — typecheck + suite + manual**

```bash
npx tsc --noEmit && npm test
```
Expected: clean + green.

Manual (dev server): load `/prompts`, pick "Control general", Extraer → network tab shows `atencionId` + `stt: "texto"` in the POST body and the `x-atencion-saved` response header. Dictate → stop within 2s of speaking → the extraction still fires (flush).

- [ ] **Step 6: Commit**

```bash
git add app/prompts/page.tsx lib/clinical-extraction.ts lib/hooks/useVoiceRecording.ts lib/types.ts
git commit -m "feat: cliente manda atencionId+stt; seed/flush del dictado; aviso de no-guardado también en voz"
```

---

### Task 10: `/historial` page + nav link

**Files:**
- Create: `app/historial/page.tsx`
- Modify: `app/layout.tsx` (nav link)
- Test: `__tests__/historial-page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/historial-page.test.tsx
// jsdom (default): render de la lista con fetch mockeado.
import { render, screen, waitFor } from '@testing-library/react'
import HistorialPage from '@/app/historial/page'

const LIST = {
  atenciones: [
    {
      id: '01JZXA0000000000000000000A',
      createdAt: '2026-07-10T14:30:00.000Z',
      updatedAt: '2026-07-10T14:35:00.000Z',
      pseudonym: 'Paciente A1B2',
      runsCount: 3,
      lastDiagnostico: 'gastritis aguda',
      hasValidation: true,
      hasSummary: false,
    },
  ],
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => LIST,
  }) as jest.Mock
})

it('renders the list with pseudonym, diagnosis and badges', async () => {
  render(<HistorialPage />)
  await waitFor(() => expect(screen.getByText('Paciente A1B2')).toBeInTheDocument())
  expect(screen.getByText(/gastritis aguda/)).toBeInTheDocument()
  expect(screen.getByText(/3 corridas/)).toBeInTheDocument()
  expect(screen.getByText(/Validada/)).toBeInTheDocument()
})

it('shows the empty state', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ atenciones: [] }) })
  render(<HistorialPage />)
  await waitFor(() => expect(screen.getByText(/Todavía no hay atenciones/)).toBeInTheDocument())
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/historial-page.test.tsx`
Expected: FAIL — cannot find module '@/app/historial/page'

- [ ] **Step 3: Write `app/historial/page.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { DataExtraction } from '../components/DataExtraction'
import { IconClipboardCheck, IconTranscript, Spinner } from '../components/icons'
import type { Atencion, AtencionListItem } from '@/lib/atenciones'

/**
 * Historial de atenciones (solo lectura). Lista newest-first; click → detalle con
 * transcript, corridas (STT + IA + prompt + resultado), última validación y último
 * resumen (cada uno con su prompt e IA). Los datos vienen ANONIMIZADOS desde el
 * guardado — acá no hay pacientes identificables.
 */

const STT_LABEL: Record<string, string> = {
  'openai-realtime': 'Dictado OpenAI',
  transcribe: 'Dictado AWS Transcribe',
  texto: 'Texto pegado',
}

function fmtFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-CL', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/** Chip "IA + modelo + prompt colapsable" reutilizado por validación y resumen. */
function MetaYPrompt({ engine, model, prompt }: { engine: string; model: string; prompt: string }) {
  return (
    <div className="space-y-2">
      <span className="inline-flex rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-soft-blue">
        {engine} · {model}
      </span>
      <details className="rounded-md bg-surface/40 p-2">
        <summary className="cursor-pointer text-xs font-semibold text-muted">
          Prompt utilizado
        </summary>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink">
          {prompt}
        </pre>
      </details>
    </div>
  )
}

export default function HistorialPage() {
  const [items, setItems] = useState<AtencionListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Atencion | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    fetch('/api/atenciones')
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error)
        return r.json()
      })
      .then((d) => setItems(Array.isArray(d?.atenciones) ? d.atenciones : []))
      .catch((e) => setError(e instanceof Error && e.message ? e.message : 'No se pudo cargar el historial.'))
      .finally(() => setLoading(false))
  }, [])

  async function openDetail(id: string) {
    setDetailLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/atenciones/${id}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error ?? `No se pudo cargar la atención (${res.status}).`)
        return
      }
      setSelected((await res.json()) as Atencion)
    } catch {
      setError('No se pudo conectar con el servidor. Intenta de nuevo.')
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-primary">
          <IconClipboardCheck className="h-3.5 w-3.5" /> Historial de atenciones
        </span>
        <h1 className="text-3xl font-bold text-primary">Revisa las respuestas previas</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Cada atención guarda el dictado enviado, el sistema de dictado usado, la IA y el
          prompt de cada paso, y sus resultados (extracción, validación y resumen). Los datos
          del paciente se guardan anonimizados; identifica cada atención por su fecha y hora.
        </p>
      </header>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="h-4 w-4" /> Cargando historial…
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-surface px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="card text-sm text-muted">
          Todavía no hay atenciones guardadas. Corre una extracción en el editor de prompts y
          aparecerá aquí automáticamente.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Lista */}
        <div className="space-y-2">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => openDetail(it.id)}
              className={`flex w-full flex-col gap-1 rounded-lg border bg-white px-4 py-3 text-left transition-colors hover:border-primary ${
                selected?.sk === it.id ? 'border-primary' : 'border-stroke'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">{it.pseudonym}</span>
                <span className="text-[11px] text-muted">{fmtFecha(it.createdAt)}</span>
              </span>
              {it.lastDiagnostico && (
                <span className="truncate text-xs text-muted">Dx: {it.lastDiagnostico}</span>
              )}
              <span className="flex flex-wrap items-center gap-2 pt-0.5">
                <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-soft-blue">
                  {it.runsCount} {it.runsCount === 1 ? 'corrida' : 'corridas'}
                </span>
                {it.hasValidation && (
                  <span className="rounded-full bg-success-surface px-2 py-0.5 text-[11px] font-medium text-success">
                    ✓ Validada
                  </span>
                )}
                {it.hasSummary && (
                  <span className="rounded-full bg-success-surface px-2 py-0.5 text-[11px] font-medium text-success">
                    ✓ Resumida
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>

        {/* Detalle */}
        <div className="space-y-4 lg:self-start">
          {detailLoading && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner className="h-4 w-4" /> Cargando atención…
            </p>
          )}
          {!detailLoading && selected && (
            <>
              <section className="card space-y-2">
                <div className="flex items-center gap-2">
                  <IconTranscript className="h-5 w-5 text-soft-blue" />
                  <h2 className="text-base font-semibold text-ink">Dictado enviado</h2>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  {selected.transcript}
                </p>
              </section>

              <section className="card space-y-3">
                <h2 className="text-base font-semibold text-ink">
                  Corridas de extracción ({selected.runs.length}
                  {selected.runsCount > selected.runs.length
                    ? ` de ${selected.runsCount} — se conservan las últimas`
                    : ''}
                  )
                </h2>
                {selected.runs.map((run, i) => (
                  <details key={run.at + i} className="rounded-lg border border-stroke p-3">
                    <summary className="cursor-pointer text-sm font-medium text-ink">
                      {fmtFecha(run.at)} · {STT_LABEL[run.stt] ?? run.stt} · {run.engine} ·{' '}
                      {run.model}
                    </summary>
                    <div className="mt-3 space-y-3">
                      <p className="text-[11px] text-muted">
                        Esta corrida procesó {run.transcriptChars} caracteres del dictado.
                      </p>
                      <details className="rounded-md bg-surface/40 p-2">
                        <summary className="cursor-pointer text-xs font-semibold text-muted">
                          Prompt utilizado
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink">
                          {run.prompt}
                        </pre>
                      </details>
                      <DataExtraction extractedData={run.result} isExtracting={false} />
                    </div>
                  </details>
                ))}
              </section>

              {selected.validation && (
                <section className="card space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-ink">
                      Última validación de consistencia
                    </h2>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        selected.validation.consistent
                          ? 'bg-success-surface text-success'
                          : 'bg-danger-surface text-danger'
                      }`}
                    >
                      {selected.validation.consistent ? 'Consistente' : 'Inconsistente'}
                    </span>
                  </div>
                  <MetaYPrompt
                    engine={selected.validation.engine}
                    model={selected.validation.model}
                    prompt={selected.validation.prompt}
                  />
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                    {selected.validation.observations || 'Sin observaciones.'}
                  </p>
                </section>
              )}

              {selected.summary && (
                <section className="card space-y-3">
                  <h2 className="text-base font-semibold text-ink">Último resumen clínico</h2>
                  <MetaYPrompt
                    engine={selected.summary.engine}
                    model={selected.summary.model}
                    prompt={selected.summary.prompt}
                  />
                  {Object.entries(selected.summary.sections).map(([k, v]) =>
                    v ? (
                      <div key={k}>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                          {k}
                        </p>
                        <p className="text-sm leading-relaxed text-ink">{v}</p>
                      </div>
                    ) : null
                  )}
                </section>
              )}
            </>
          )}
          {!detailLoading && !selected && items.length > 0 && (
            <div className="card text-sm text-muted">
              Elige una atención de la lista para ver su detalle.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add the nav link in `app/layout.tsx`**

Inside `<nav>` (lines 37-43), after the existing `/prompts` NavLink:

```tsx
              <NavLink href="/historial">
                <IconClipboardCheck className="h-4 w-4" /> Historial
              </NavLink>
```

And extend the icons import (line 4):

```tsx
import { LogoMark, IconSparkles, IconClipboardCheck } from './components/icons'
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx jest __tests__/historial-page.test.tsx && npx tsc --noEmit`
Expected: PASS (2 tests), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add app/historial app/layout.tsx __tests__/historial-page.test.tsx
git commit -m "feat: página /historial (dictado, STT, IA, prompts y resultados por atención)"
```

---

### Task 11: Infra doc + exact commands (the user runs them)

**Files:**
- Create: `infra/atenciones-historial.md`

- [ ] **Step 1: Write `infra/atenciones-historial.md`**

````markdown
# Historial de atenciones — infra (POC)

Todo se ejecuta con el perfil `cloudforge-medconsult` (validado 2026-07-10: DeveloperAccess
puede crear tablas y escribir políticas de rol — no se necesita al admin).

## 1. Tabla DynamoDB

```bash
aws dynamodb create-table \
  --profile cloudforge-medconsult --region us-east-1 \
  --table-name medconsult-poc-atenciones \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=project,Value=medconsult-poc

aws dynamodb wait table-exists --table-name medconsult-poc-atenciones \
  --profile cloudforge-medconsult --region us-east-1
```

## 2. Política del rol OIDC de Vercel (aditiva — NO toca las 2 existentes)

```bash
aws iam put-role-policy \
  --profile cloudforge-medconsult \
  --role-name medconsult-poc-vercel \
  --policy-name medconsult-poc-atenciones-ddb \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "AtencionesTable",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"],
      "Resource": "arn:aws:dynamodb:us-east-1:889268462469:table/medconsult-poc-atenciones"
    }]
  }'
```

## 3. Env vars en Vercel (proyecto `medconsult_test`, team arcturus91s-projects)

```bash
# genera un secreto para la firma de la cookie
openssl rand -hex 32

# desde el directorio del repo (vercel link ya hecho):
vercel env add POC_ACCESS_CODE production   # pega el código a compartir con el doctor
vercel env add POC_COOKIE_SECRET production # pega el hex de arriba
vercel env add POC_ACCESS_CODE preview
vercel env add POC_COOKIE_SECRET preview
```

Nota: el gate es inerte si faltan las dos variables — por eso el deploy es seguro
aunque las env vars se agreguen después del merge (la app queda abierta hasta setearlas,
igual que hoy). Orden recomendado: env vars primero, deploy después.

## 4. Verificación post-deploy

```bash
# sin cookie → páginas redirigen, APIs 401
curl -s -o /dev/null -w '%{http_code}' https://medconsult.cloud-forge-ai.com/api/models   # 401
curl -s -o /dev/null -w '%{http_code}' -L https://medconsult.cloud-forge-ai.com/prompts    # 200 (aterriza en /acceso)

# lectura del historial a nivel de datos
aws dynamodb query --profile cloudforge-medconsult --region us-east-1 \
  --table-name medconsult-poc-atenciones \
  --key-condition-expression 'pk = :pk' \
  --expression-attribute-values '{":pk":{"S":"ATENCION"}}' \
  --no-scan-index-forward --max-items 3
```
````

- [ ] **Step 2: Commit**

```bash
git add infra/atenciones-historial.md
git commit -m "docs: comandos de infra del historial (tabla, política, env vars, verificación)"
```

---

### Task 12: Full verification + PR

- [ ] **Step 1: Full local gates**

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```
Expected: suite green (≈47 tests across 9 files), tsc/lint clean, build succeeds.

- [ ] **Step 2: Manual e2e in dev** (with `.env.local`: `POC_ACCESS_CODE=test123`, `POC_COOKIE_SECRET=dev-secret`, and AWS SSO logged in so the repo writes the real table — requires Task 11 step 1 already run)

1. `/prompts` → redirects to `/acceso`; enter `test123` → in.
2. Load sample "Control general" → Extraer (Bedrock) → response OK; no warning shown.
3. Validar and Resumir → OK.
4. Dictate a few seconds (either STT) → stop immediately after speaking → the trailing text still extracts (flush).
5. `/historial` → the atención appears (pseudonym, no "Juan Pérez"); detail shows scrubbed transcript (`RUT-OCULTO`), each run with STT + engine/model + prompt + chars, última validación y último resumen with their prompts.
6. `aws dynamodb query` (infra doc §4) → item exists, no real identifiers anywhere.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/historial-atenciones
gh pr create --base main --title "Historial de atenciones + código de acceso" --body "$(cat <<'EOF'
## Qué hace
- Persiste cada atención **anonimizada** (seudónimo determinístico + scrub de nombre/RUT) en DynamoDB `medconsult-poc-atenciones`, con visibilidad completa por paso: transcript, **STT usado** (OpenAI Realtime / Transcribe / texto), **IA y modelo**, **prompt** y **resultado** de extracción, validación y resumen.
- `atencionId` (ULID) opcional y aditivo en `/api/extract|validate|summarize` — sin él, comportamiento idéntico a hoy. Persistencia best-effort: nunca bloquea la respuesta clínica (header `x-atencion-saved`).
- Dictado coherente: el buffer se siembra al re-grabar y hay flush al detener (la última corrida refleja el dictado completo). Escrituras sin pisarse (lock optimista + UpdateItem por atributo).
- Página `/historial` (lista newest-first + detalle, solo lectura) + link en nav.
- Código de acceso compartido: `proxy.ts` (Next 16) cierra TODAS las páginas y APIs; pantalla `/acceso`; gate inerte hasta setear `POC_ACCESS_CODE`/`POC_COOKIE_SECRET`.

## Infra (correr antes del deploy — comandos exactos en `infra/atenciones-historial.md`)
1. Crear tabla `medconsult-poc-atenciones` (on-demand)
2. Política inline `medconsult-poc-atenciones-ddb` en el rol `medconsult-poc-vercel` (aditiva)
3. Env vars Vercel: `POC_ACCESS_CODE`, `POC_COOKIE_SECRET`

## Spec
`docs/superpowers/specs/2026-07-10-historial-atenciones-design.md` (v2, post revisión adversaria)

## Tests
Jest: ULID, anonimizador, repo DDB (lock optimista, mocked), capa best-effort, contrato de rutas (stt+meta), gate de acceso, página historial. `tsc`/lint/build limpios.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Report to the owner** — PR link + reminder: infra steps (table + policy + env vars) before merge/deploy; after deploy, share the access code with the doctor and note the app now requires it.

---

## Self-Review (updated after the adversarial review of 2026-07-10)

**Adversarial findings incorporated:**
- F1 (STT never captured) → `stt` on the extract POST + `AtencionRun.stt` + `/historial` run header (Tasks 3, 4, 5, 9, 10).
- F2/F3 (validation/summary prompts + engine/model dropped) → `RunMeta` threading from both routes into `AtencionValidation`/`AtencionSummary` + `MetaYPrompt` in the UI (Tasks 3, 4, 5, 10).
- F4 (re-recording lost earlier dictation) → `seed()` + `fullTranscriptRef` (Task 9).
- F5 (trailing dictation lost to the debounce) → `flush()` on stop (Task 9).
- F6 (lost updates) → optimistic lock on `recordRun` (one retry) + `UpdateItem` for validation/summary (Task 3).
- F7 (multi-patient merge) → `onNewDictation` rotates the id when dictating over an empty transcript; residual merged-dictation risk documented in spec v2 §Anonimización.
- F8 (exact prompt) → Bedrock lane persists `${instructions}\n\n${JSON_SHAPE}`; template-only for the other lanes, rationale in Task 5 preamble.
- F9 (silent voice-lane failures) → `onSaveStatus` callback + `RecordingState.saveWarn` (Task 9).
- F13 (per-run input untraceable) → `transcriptChars` per run + UI note (Tasks 3, 10).

**Accepted limitations (documented in spec v2):** only the LAST validation/summary is kept (F10 — UI labels them "última"); `/` redirects to `/prompts` so `lib/api.ts`/`VoiceRecorder` dead code stays un-instrumented (F12); header-over-body for the saved flag (F11 — deliberate, keeps the doctor's raw JSON pristine).

**Type consistency:** `AtencionRun {at, stt, engine, model, prompt, transcriptChars, result}`, `AtencionValidation`/`AtencionSummary` with `prompt/engine/model/at` defined once in `lib/atenciones.ts` and used consistently in Tasks 4-6 and 10. `RunMeta` defined in `lib/persist-atencion.ts`, consumed by Task 5. Header name `x-atencion-saved` consistent across Tasks 5 and 9. Cookie name via `ACCESS_COOKIE` export. `ClinicalExtractionService` constructor arity (8) matches the hook's construction in Task 9. ✓

**Placeholder scan:** every code step contains full code; no TBDs. ✓
