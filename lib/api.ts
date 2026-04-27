// Local OpenAI-based validation & summarization (no backend needed)

import { CONSISTENCY_PROMPT, SUMMARIZE_PROMPT } from './prompts'
import type { ExtractedData } from './types'

const OPENAI_API_KEY = process.env.NEXT_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY || ''

interface ConsultationSections {
  antecedentes: string | null
  motivoConsulta: string | null
  examenFisico: string | null
  diagnostico: string | null
  planTrabajo: string | null
}

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

function buildSections(data: ExtractedData): ConsultationSections {
  const s = data.clinicalSections
  return {
    antecedentes: s.antecedentes,
    motivoConsulta: s.anamnesis,
    examenFisico: s.examenFisico,
    diagnostico: s.diagnostico,
    planTrabajo: s.plan,
  }
}

async function callOpenAI(
  systemMessage: string,
  userPrompt: string,
  maxTokens: number,
): Promise<Record<string, unknown>> {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`OpenAI error ${resp.status}: ${err}`)
  }

  const body = await resp.json()
  const content = body.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty OpenAI response')
  return JSON.parse(content)
}

export async function validateConsistency(data: ExtractedData): Promise<ValidationResult> {
  const sections = buildSections(data)
  const consultationData = JSON.stringify(
    { antecedentes: sections.antecedentes || '', planTrabajo: sections.planTrabajo || '' },
    null,
    2,
  )
  const prompt = CONSISTENCY_PROMPT.replace('$CONSULTATION_DATA', consultationData)

  const result = await callOpenAI(
    'Eres un médico experto en validación de historias clínicas. Respondes únicamente en formato JSON.',
    prompt,
    300,
  )

  return {
    consistent: result.consistent === true,
    observations: (result.observations as string) || '',
  }
}

export async function summarizeSections(data: ExtractedData): Promise<SummarizedSections> {
  const sections = buildSections(data)
  const consultationData = JSON.stringify(sections, null, 2)
  const prompt = SUMMARIZE_PROMPT.replace('$CONSULTATION_DATA', consultationData)

  const result = await callOpenAI(
    'Eres un médico experto en resumir historias clínicas de manera concisa. Respondes únicamente en formato JSON.',
    prompt,
    800,
  )

  return {
    antecedentes: (result.antecedentes as string) || sections.antecedentes || '',
    motivoConsulta: (result.motivoConsulta as string) || sections.motivoConsulta || '',
    examenFisico: (result.examenFisico as string) || sections.examenFisico || '',
    diagnostico: (result.diagnostico as string) || sections.diagnostico || '',
    planTrabajo: (result.planTrabajo as string) || sections.planTrabajo || '',
  }
}
