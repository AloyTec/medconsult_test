// Server-only. Calls Claude on Amazon Bedrock (IAM-scoped, no API key), following the
// DexaVision pattern (dexa-backend/lambda/shared/services/bedrock.ts): InvokeModelCommand
// + anthropic_version, cross-region inference profile, JSON parse with markdown-fence strip.
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'

const REGION = process.env.AWS_REGION || 'us-east-1'
// Global cross-region inference profile — ~10% cheaper per token than the us.* geographic
// profile (billed from the source region; requests may route to any AWS commercial region).
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-haiku-4-5-20251001-v1:0'

let cachedClient: BedrockRuntimeClient | null = null
function getClient(): BedrockRuntimeClient {
  if (!cachedClient) {
    cachedClient = new BedrockRuntimeClient({
      region: REGION,
      // On Vercel: assume the scoped role via OIDC (no static key). Locally (no
      // AWS_ROLE_ARN): default credential chain / SSO. See infra/vercel-aws-oidc.md.
      ...(process.env.AWS_ROLE_ARN
        ? { credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }) }
        : {}),
    })
  }
  return cachedClient
}

interface BedrockTextBlock {
  type: string
  text?: string
}
interface BedrockBody {
  content?: BedrockTextBlock[]
  stop_reason?: string
}

/**
 * Invoke Claude (Haiku 4.5 by default) with a system instruction + user text, expecting
 * a JSON object back. Returns the parsed object.
 */
export async function invokeClaudeJson(
  system: string,
  userText: string,
  maxTokens = 1024,
  modelId?: string
): Promise<Record<string, unknown>> {
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    temperature: 0.3,
  }

  const command = new InvokeModelCommand({
    modelId: modelId || MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  })

  const response = await getClient().send(command)
  if (!response.body) throw new Error('Bedrock devolvió un cuerpo vacío')

  const body = JSON.parse(new TextDecoder().decode(response.body)) as BedrockBody
  let text = body.content?.find((c) => c.type === 'text')?.text ?? ''

  // Strip ```json ... ``` fences if the model wrapped the JSON.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced) text = fenced[1].trim()

  try {
    return JSON.parse(text)
  } catch {
    // Fall back to the last top-level { ... } block.
    const block = text.match(/\{[\s\S]*\}/)
    if (block) {
      try {
        return JSON.parse(block[0])
      } catch {
        // fall through to the diagnostic errors below
      }
    }
    // PII-safe diagnostics (shape only, never content): enough to tell truncation
    // from prose/refusal in the Vercel logs next time this fires.
    console.error('Bedrock JSON parse failed:', {
      stopReason: body.stop_reason ?? null,
      textLength: text.length,
      hadFence: Boolean(fenced),
      hadBlock: Boolean(block),
    })
    // Most common cause of unparseable JSON: the model hit max_tokens and the JSON
    // was cut off mid-object (transient — verbose models on long inputs). Surface it.
    if (body.stop_reason === 'max_tokens') {
      throw new Error(
        'La respuesta de Bedrock se cortó por el límite de tokens (max_tokens). Reintenta o sube el límite.'
      )
    }
    throw new Error('La respuesta de Bedrock no es JSON válido')
  }
}

export function getBedrockModelId(): string {
  return MODEL_ID
}
