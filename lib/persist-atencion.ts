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
