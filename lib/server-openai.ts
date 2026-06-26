// Server-only helper. Imported exclusively by route handlers (app/api/**), so the
// OpenAI key is read from server env (NO NEXT_PUBLIC_) and never ships to the browser.
import type { ExtractedData } from './types'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''

export interface ConsultationSections {
  antecedentes: string | null
  motivoConsulta: string | null
  examenFisico: string | null
  diagnostico: string | null
  planTrabajo: string | null
}

export function buildSections(data: ExtractedData): ConsultationSections {
  const s = data.clinicalSections
  return {
    antecedentes: s.antecedentes,
    motivoConsulta: s.anamnesis,
    examenFisico: s.examenFisico,
    diagnostico: s.diagnostico,
    planTrabajo: s.plan,
  }
}

export async function callOpenAIJson(
  systemMessage: string,
  userPrompt: string,
  maxTokens: number,
  model = 'gpt-4o-mini'
): Promise<Record<string, unknown>> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY no está configurada en el servidor')
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
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
    throw new Error(`OpenAI error ${resp.status}`)
  }

  const body = await resp.json()
  const content = body.choices?.[0]?.message?.content
  if (!content) throw new Error('Respuesta vacía de OpenAI')
  return JSON.parse(content)
}
