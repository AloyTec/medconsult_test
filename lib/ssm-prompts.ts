// Server-only. Reads/writes the POC prompts in a DEDICATED, ISOLATED SSM namespace
// (/medconsult/poc/prompts/*) — separate from the real /medconsult/{dev,prd}/prompts/*,
// so persisting here NEVER affects the deployed backend behavior. Replicates the real
// admin mechanism (read/write SSM) against test parameters.
import {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
  ParameterNotFound,
} from '@aws-sdk/client-ssm'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'
import { EXTRACTION_PROMPT } from './extraction-schema'
import { CONSISTENCY_PROMPT, SUMMARIZE_PROMPT } from './prompts'

const REGION = process.env.AWS_REGION || 'us-east-1'
const PREFIX = '/medconsult/poc/prompts'

export type PromptKey = 'extraction' | 'consistency' | 'summarize'
export const PROMPT_KEYS: PromptKey[] = ['extraction', 'consistency', 'summarize']

// Bundled defaults — what the editor shows until a value is saved to SSM.
export const PROMPT_DEFAULTS: Record<PromptKey, string> = {
  extraction: EXTRACTION_PROMPT,
  consistency: CONSISTENCY_PROMPT,
  summarize: SUMMARIZE_PROMPT,
}

let cachedClient: SSMClient | null = null
function getClient(): SSMClient {
  if (!cachedClient) {
    cachedClient = new SSMClient({
      region: REGION,
      // On Vercel: scoped role via OIDC (no static key). Locally: SSO / default chain.
      ...(process.env.AWS_ROLE_ARN
        ? { credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }) }
        : {}),
    })
  }
  return cachedClient
}

const paramName = (key: PromptKey) => `${PREFIX}/${key}`

export interface PromptValue {
  value: string
  source: 'ssm' | 'default'
}

/** SSM value if a saved one exists, else the bundled default. */
export async function readPrompt(key: PromptKey): Promise<PromptValue> {
  try {
    const res = await getClient().send(new GetParameterCommand({ Name: paramName(key) }))
    const value = res.Parameter?.Value
    if (value) return { value, source: 'ssm' }
  } catch (err) {
    if (!(err instanceof ParameterNotFound)) throw err
  }
  return { value: PROMPT_DEFAULTS[key], source: 'default' }
}

export async function readAllPrompts(): Promise<Record<PromptKey, PromptValue>> {
  const entries = await Promise.all(
    PROMPT_KEYS.map(async (k) => [k, await readPrompt(k)] as const)
  )
  return Object.fromEntries(entries) as Record<PromptKey, PromptValue>
}

/** Persist a prompt to its test SSM parameter. Intelligent-Tiering handles >4KB prompts. */
export async function writePrompt(key: PromptKey, value: string): Promise<void> {
  await getClient().send(
    new PutParameterCommand({
      Name: paramName(key),
      Value: value,
      Type: 'String',
      Overwrite: true,
      Tier: 'Intelligent-Tiering',
    })
  )
}
