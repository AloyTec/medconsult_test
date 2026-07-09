/**
 * @jest-environment node
 */
// __tests__/bedrock.test.ts
// invokeClaudeJson parse paths: fenced JSON, prose (no JSON), truncation (max_tokens).
// The Bedrock client is mocked — no network, no credentials. Server-only code
// (TextEncoder/TextDecoder), so it runs in the node environment, not jsdom.
import { invokeClaudeJson } from '@/lib/bedrock'

const mockSend = jest.fn()

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn(() => ({ send: mockSend })),
  InvokeModelCommand: jest.fn((input) => input),
}))

jest.mock('@vercel/oidc-aws-credentials-provider', () => ({
  awsCredentialsProvider: jest.fn(),
}))

function bedrockResponse(text: string, stopReason = 'end_turn') {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({ content: [{ type: 'text', text }], stop_reason: stopReason })
    ),
  }
}

describe('invokeClaudeJson', () => {
  beforeEach(() => {
    mockSend.mockReset()
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('parses a plain JSON response', async () => {
    mockSend.mockResolvedValue(bedrockResponse('{"patient":{"name":"Ana"}}'))
    await expect(invokeClaudeJson('sys', 'user')).resolves.toEqual({
      patient: { name: 'Ana' },
    })
  })

  it('parses JSON wrapped in ```json fences', async () => {
    mockSend.mockResolvedValue(bedrockResponse('```json\n{"ok":true}\n```'))
    await expect(invokeClaudeJson('sys', 'user')).resolves.toEqual({ ok: true })
  })

  it('parses JSON surrounded by prose via the { ... } block fallback', async () => {
    mockSend.mockResolvedValue(bedrockResponse('Aquí está el resultado: {"ok":true} ¡Listo!'))
    await expect(invokeClaudeJson('sys', 'user')).resolves.toEqual({ ok: true })
  })

  it('reports truncation when the JSON was cut off at max_tokens', async () => {
    mockSend.mockResolvedValue(
      bedrockResponse('{"patient":{"name":"Ana"},"clinicalSections":{"anamnesis":"paciente', 'max_tokens')
    )
    await expect(invokeClaudeJson('sys', 'user')).rejects.toThrow(/max_tokens/)
  })

  it('throws the generic error on prose with no JSON, logging PII-safe diagnostics', async () => {
    mockSend.mockResolvedValue(bedrockResponse('No hay dictado que procesar.'))
    await expect(invokeClaudeJson('sys', 'user')).rejects.toThrow(
      'La respuesta de Bedrock no es JSON válido'
    )
    expect(console.error).toHaveBeenCalledWith(
      'Bedrock JSON parse failed:',
      expect.objectContaining({ stopReason: 'end_turn', hadFence: false, hadBlock: false })
    )
    // Diagnostics must never include the response content.
    const logged = JSON.stringify((console.error as jest.Mock).mock.calls)
    expect(logged).not.toContain('dictado')
  })
})
