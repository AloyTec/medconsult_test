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

// Margen bajo el límite duro de 400KB por item de DynamoDB (JSON length ≈ bytes
// para texto mayormente ASCII; aproximación aceptada en el spec).
const MAX_ITEM_CHARS = 350_000
const PROMPT_TRUNCADO = '…[prompt truncado por tamaño]'

/**
 * Degradación del spec: si el item roza los 400KB, recorta el prompt de las
 * corridas más viejas (la más reciente se conserva completa) y lo loguea,
 * antes que dejar el write fallando para siempre.
 */
function shrinkItem(item: Atencion): Atencion {
  if (JSON.stringify(item).length <= MAX_ITEM_CHARS) return item
  const runs = item.runs.map((r) => ({ ...r }))
  for (let i = 0; i < runs.length - 1; i++) {
    if (runs[i].prompt.length > 200) {
      runs[i].prompt = runs[i].prompt.slice(0, 200) + PROMPT_TRUNCADO
    }
    if (JSON.stringify({ ...item, runs }).length <= MAX_ITEM_CHARS) break
  }
  const shrunk = { ...item, runs }
  console.error('recordRun: item cerca del límite de 400KB, prompts antiguos truncados', {
    sk: item.sk,
    runs: runs.length,
  })
  return shrunk
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

    const item = shrinkItem({
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
    })
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
