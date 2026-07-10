import { NextRequest, NextResponse } from 'next/server'
import { CONSISTENCY_PROMPT } from '@/lib/prompts'
import { buildSections, callOpenAIJson } from '@/lib/server-openai'
import { invokeClaudeJson, getBedrockModelId } from '@/lib/bedrock'
import { persistValidation } from '@/lib/persist-atencion'
import type { ExtractedData } from '@/lib/types'

const SYSTEM =
  'Eres un médico experto en validación de historias clínicas. Respondes únicamente en formato JSON.'

// Inject the consultation data into the (editable) prompt: replace $CONSULTATION_DATA if
// present, else append it so the model always receives the data even if the marker was removed.
function withData(prompt: string, consultationData: string): string {
  return prompt.includes('$CONSULTATION_DATA')
    ? prompt.replace('$CONSULTATION_DATA', consultationData)
    : `${prompt}\n\n${consultationData}`
}

/**
 * Server-side consistency validation. The client posts the extracted data + the (editable)
 * prompt + engine/model; the OpenAI/Bedrock call + key/IAM stay here (never in the browser).
 */
export async function POST(req: NextRequest) {
  try {
    const { data, prompt, engine, model, atencionId } = (await req.json()) as {
      data: ExtractedData
      prompt?: string
      engine?: string
      model?: string
      atencionId?: string
    }
    if (!data?.clinicalSections) {
      return NextResponse.json({ error: 'Falta "data" con clinicalSections.' }, { status: 400 })
    }

    const sections = buildSections(data)
    const consultationData = JSON.stringify(
      { antecedentes: sections.antecedentes || '', planTrabajo: sections.planTrabajo || '' },
      null,
      2
    )
    const instructions =
      typeof prompt === 'string' && prompt.trim().length > 0 ? prompt : CONSISTENCY_PROMPT
    const userPrompt = withData(instructions, consultationData)
    const useModel = typeof model === 'string' && model.trim().length > 0 ? model : undefined

    // 1024 tokens: room for verbose models (e.g. Sonnet) so the JSON isn't truncated
    // mid-object — truncation was the transient "respuesta no es JSON válido" cause.
    const result =
      engine === 'bedrock'
        ? await invokeClaudeJson(SYSTEM, userPrompt, 1024, useModel)
        : await callOpenAIJson(SYSTEM, userPrompt, 1024, useModel)

    const payload = {
      consistent: result.consistent === true,
      observations: (result.observations as string) || '',
    }
    const saved =
      atencionId === undefined
        ? null
        : await persistValidation(atencionId, data.patient, payload, {
            // La plantilla editable (con $CONSULTATION_DATA): los datos inyectados ya
            // son visibles como extracción en el mismo registro — no se duplican.
            prompt: instructions,
            engine: engine === 'bedrock' ? 'bedrock' : 'openai',
            model: useModel ?? (engine === 'bedrock' ? getBedrockModelId() : 'gpt-4o-mini'),
          })
    return NextResponse.json(payload, {
      ...(saved === null ? {} : { headers: { 'x-atencion-saved': String(saved) } }),
    })
  } catch (error) {
    console.error('Validate error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'La validación falló.' },
      { status: 500 }
    )
  }
}
