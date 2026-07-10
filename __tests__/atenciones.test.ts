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

  it('degrades old prompts instead of failing when the item nears 400KB', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const bigPrompt = 'p'.repeat(30_000)
    const existingRuns = Array.from({ length: 12 }, (_, i) => ({
      ...RUN_INPUT,
      prompt: bigPrompt,
      at: `t${i}`,
    }))
    mockSend.mockResolvedValueOnce({
      Item: {
        pk: 'ATENCION', sk: ID, createdAt: 'c', updatedAt: 'x', pseudonym: 'P',
        transcript: 't', runs: existingRuns, runsCount: 12, lastDiagnostico: null,
      },
    })
    mockSend.mockResolvedValueOnce({})
    await recordRun(ID, 'P', { ...RUN_INPUT, prompt: bigPrompt })
    const put = mockSend.mock.calls[1][0]
    expect(JSON.stringify(put.Item).length).toBeLessThanOrEqual(350_000)
    // la corrida MÁS RECIENTE conserva su prompt completo
    expect(put.Item.runs[put.Item.runs.length - 1].prompt).toBe(bigPrompt)
    // las viejas quedan truncadas con marcador
    expect(put.Item.runs[0].prompt).toContain('[prompt truncado')
    jest.restoreAllMocks()
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
