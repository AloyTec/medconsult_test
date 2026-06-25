import { NextRequest, NextResponse } from 'next/server'
import { CONSISTENCY_PROMPT } from '@/lib/prompts'
import { buildSections, callOpenAIJson } from '@/lib/server-openai'
import type { ExtractedData } from '@/lib/types'

/**
 * Server-side consistency validation. The client posts the extracted data; the
 * OpenAI call + key stay here (never in the browser).
 */
export async function POST(req: NextRequest) {
  try {
    const { data } = (await req.json()) as { data: ExtractedData }
    if (!data?.clinicalSections) {
      return NextResponse.json({ error: 'Falta "data" con clinicalSections.' }, { status: 400 })
    }

    const sections = buildSections(data)
    const consultationData = JSON.stringify(
      { antecedentes: sections.antecedentes || '', planTrabajo: sections.planTrabajo || '' },
      null,
      2
    )
    const prompt = CONSISTENCY_PROMPT.replace('$CONSULTATION_DATA', consultationData)

    const result = await callOpenAIJson(
      'Eres un médico experto en validación de historias clínicas. Respondes únicamente en formato JSON.',
      prompt,
      300
    )

    return NextResponse.json({
      consistent: result.consistent === true,
      observations: (result.observations as string) || '',
    })
  } catch (error) {
    console.error('Validate error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'La validación falló.' },
      { status: 500 }
    )
  }
}
