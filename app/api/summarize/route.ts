import { NextRequest, NextResponse } from 'next/server'
import { SUMMARIZE_PROMPT } from '@/lib/prompts'
import { buildSections, callOpenAIJson } from '@/lib/server-openai'
import type { ExtractedData } from '@/lib/types'

/**
 * Server-side clinical summarization. The client posts the extracted data; the
 * OpenAI call + key stay here (never in the browser).
 */
export async function POST(req: NextRequest) {
  try {
    const { data } = (await req.json()) as { data: ExtractedData }
    if (!data?.clinicalSections) {
      return NextResponse.json({ error: 'Falta "data" con clinicalSections.' }, { status: 400 })
    }

    const sections = buildSections(data)
    const consultationData = JSON.stringify(sections, null, 2)
    const prompt = SUMMARIZE_PROMPT.replace('$CONSULTATION_DATA', consultationData)

    const result = await callOpenAIJson(
      'Eres un médico experto en resumir historias clínicas de manera concisa. Respondes únicamente en formato JSON.',
      prompt,
      800
    )

    return NextResponse.json({
      antecedentes: (result.antecedentes as string) || sections.antecedentes || '',
      motivoConsulta: (result.motivoConsulta as string) || sections.motivoConsulta || '',
      examenFisico: (result.examenFisico as string) || sections.examenFisico || '',
      diagnostico: (result.diagnostico as string) || sections.diagnostico || '',
      planTrabajo: (result.planTrabajo as string) || sections.planTrabajo || '',
    })
  } catch (error) {
    console.error('Summarize error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'El resumen falló.' },
      { status: 500 }
    )
  }
}
