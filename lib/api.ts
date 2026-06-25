// Thin client for clinical validation & summarization.
// Calls our OWN server routes (/api/validate, /api/summarize) — the OpenAI key and
// the upstream provider call live server-side and never reach the browser.

import type { ExtractedData } from './types'

export interface ValidationResult {
  consistent: boolean
  observations: string
}

export interface SummarizedSections {
  antecedentes: string
  motivoConsulta: string
  examenFisico: string
  diagnostico: string
  planTrabajo: string
}

async function postData<T>(url: string, data: ExtractedData): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `${url} falló (${res.status})`)
  }
  return res.json() as Promise<T>
}

export function validateConsistency(data: ExtractedData): Promise<ValidationResult> {
  return postData<ValidationResult>('/api/validate', data)
}

export function summarizeSections(data: ExtractedData): Promise<SummarizedSections> {
  return postData<SummarizedSections>('/api/summarize', data)
}
