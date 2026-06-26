import { NextRequest, NextResponse } from 'next/server'
import { SUMMARIZE_PROMPT } from '@/lib/prompts'
import { buildSections, callOpenAIJson } from '@/lib/server-openai'
import { invokeClaudeJson } from '@/lib/bedrock'
import type { ExtractedData } from '@/lib/types'

const SYSTEM =
  'Eres un médico experto en resumir historias clínicas de manera concisa. Respondes únicamente en formato JSON.'

// Inject the consultation data into the (editable) prompt: replace $CONSULTATION_DATA if
// present, else append it so the model always receives the data even if the marker was removed.
function withData(prompt: string, consultationData: string): string {
  return prompt.includes('$CONSULTATION_DATA')
    ? prompt.replace('$CONSULTATION_DATA', consultationData)
    : `${prompt}\n\n${consultationData}`
}

/**
 * Server-side clinical summarization. The client posts the extracted data + the (editable)
 * prompt + engine/model; the OpenAI/Bedrock call + key/IAM stay here (never in the browser).
 */
export async function POST(req: NextRequest) {
  try {
    const { data, prompt, engine, model } = (await req.json()) as {
      data: ExtractedData
      prompt?: string
      engine?: string
      model?: string
    }
    if (!data?.clinicalSections) {
      return NextResponse.json({ error: 'Falta "data" con clinicalSections.' }, { status: 400 })
    }

    const sections = buildSections(data)
    const consultationData = JSON.stringify(sections, null, 2)
    const instructions =
      typeof prompt === 'string' && prompt.trim().length > 0 ? prompt : SUMMARIZE_PROMPT
    const userPrompt = withData(instructions, consultationData)
    const useModel = typeof model === 'string' && model.trim().length > 0 ? model : undefined

    // 2048 tokens: the summary has 5 sections; give verbose models room so the JSON
    // isn't cut off (truncation = the transient "respuesta no es JSON válido" error).
    const result =
      engine === 'bedrock'
        ? await invokeClaudeJson(SYSTEM, userPrompt, 2048, useModel)
        : await callOpenAIJson(SYSTEM, userPrompt, 2048, useModel)

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
