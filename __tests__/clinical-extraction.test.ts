/**
 * @jest-environment node
 */
// __tests__/clinical-extraction.test.ts
// Semántica de seed/flush del carril de voz: el flush no duplica extracciones
// (costo LLM + corridas casi idénticas en el historial) y el seed precarga el
// buffer para que dictar de nuevo continúe la misma atención.
import { ClinicalExtractionService } from '@/lib/clinical-extraction'

function okResponse() {
  return {
    ok: true,
    json: async () => ({ patient: {}, clinicalSections: {} }),
    headers: { get: () => null },
  }
}

describe('ClinicalExtractionService seed/flush', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    global.fetch = jest.fn().mockResolvedValue(okResponse()) as jest.Mock
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('seed() preloads the buffer so the next extraction includes prior dictation', async () => {
    const svc = new ClinicalExtractionService(jest.fn(), jest.fn())
    svc.seed('texto previo')
    svc.addTranscript('nuevo segmento')
    await svc.flush()
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.transcript).toBe('texto previo nuevo segmento')
  })

  it('flush() with a pending debounce extracts exactly once', async () => {
    const svc = new ClinicalExtractionService(jest.fn(), jest.fn())
    svc.addTranscript('hola')
    await svc.flush()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('flush() after the debounce already fired does NOT duplicate the call', async () => {
    const svc = new ClinicalExtractionService(jest.fn(), jest.fn())
    svc.addTranscript('hola')
    jest.advanceTimersByTime(2000) // el debounce dispara la extracción (queda en vuelo)
    await svc.flush() // debe esperar la que está en vuelo, no re-extraer
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('flush() with empty buffer and nothing in flight resolves without fetching', async () => {
    const svc = new ClinicalExtractionService(jest.fn(), jest.fn())
    await svc.flush()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
