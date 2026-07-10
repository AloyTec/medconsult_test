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
