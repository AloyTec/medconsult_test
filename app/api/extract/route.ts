import { NextRequest, NextResponse } from 'next/server'
import { EXTRACTION_PROMPT, EXTRACTION_SCHEMA } from '@/lib/extraction-schema'
import { invokeClaudeJson } from '@/lib/bedrock'

// Exact JSON shape for the Bedrock lane. OpenAI enforces it via EXTRACTION_SCHEMA
// (json_schema); Bedrock InvokeModel has no schema enforcement, so we spell it out.
const JSON_SHAPE = `Devuelve SOLO un objeto JSON con esta forma EXACTA (sin texto adicional):
{"patient":{"name":string|null,"lastName":string|null,"age":number|null,"document":string|null,"docType":0|1|3|null},"clinicalSections":{"antecedentes":string|null,"anamnesis":string|null,"examenFisico":string|null,"diagnostico":string|null,"plan":string|null}}`

/**
 * Server-side proxy for clinical data extraction.
 * Calls OpenAI Responses API with gpt-4o-mini and JSON schema.
 * Matches Flutter's extractStructuredData() exactly.
 */
export async function POST(req: NextRequest) {
  const { transcript, prompt, engine, model } = await req.json()

  if (!transcript || typeof transcript !== 'string') {
    return NextResponse.json(
      { error: 'transcript is required' },
      { status: 400 }
    )
  }

  // The prompt is editable from the UI (the whole point of the POC): the client sends
  // the (possibly edited) prompt per request. Falls back to the canonical default when
  // absent/blank, so existing callers that only send { transcript } keep working.
  const instructions =
    typeof prompt === 'string' && prompt.trim().length > 0
      ? prompt
      : EXTRACTION_PROMPT

  // ── AWS Bedrock lane (Claude Haiku 4.5, IAM-scoped — no API key) ──
  if (engine === 'bedrock') {
    try {
      const result = await invokeClaudeJson(`${instructions}\n\n${JSON_SHAPE}`, transcript, 1024)
      return NextResponse.json(result)
    } catch (error) {
      console.error('Bedrock extraction error:', error)
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Bedrock extraction failed' },
        { status: 500 }
      )
    }
  }

  // ── OpenAI lane (default) ──
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY not configured' },
      { status: 500 }
    )
  }

  // The model is selectable from the UI (listed via /api/models). Default gpt-4o-mini.
  const openaiModel =
    typeof model === 'string' && model.trim().length > 0 ? model : 'gpt-4o-mini'

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: openaiModel,
        input: transcript,
        instructions,
        text: {
          format: {
            name: 'default',
            type: 'json_schema',
            schema: EXTRACTION_SCHEMA,
          },
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Extraction API failed:', response.status, errorText)
      return NextResponse.json(
        { error: `Extraction failed: ${response.status}` },
        { status: response.status }
      )
    }

    const data = await response.json()

    // Extract JSON from the response output
    let extracted = null
    if (data.output && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === 'message' && item.content) {
          for (const content of item.content) {
            if (content.type === 'output_text' && content.text) {
              try {
                extracted = JSON.parse(content.text)
              } catch {
                // Not valid JSON
              }
            }
          }
        }
      }
    }

    if (!extracted) {
      return NextResponse.json(
        { error: 'No structured data in response' },
        { status: 500 }
      )
    }

    return NextResponse.json(extracted)
  } catch (error) {
    console.error('Extraction error:', error)
    return NextResponse.json(
      { error: 'Extraction request failed' },
      { status: 500 }
    )
  }
}
