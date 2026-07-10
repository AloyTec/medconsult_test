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
