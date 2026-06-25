import { NextRequest, NextResponse } from 'next/server'
import { readAllPrompts, writePrompt, PROMPT_KEYS, type PromptKey } from '@/lib/ssm-prompts'

/**
 * Prompt persistence against the isolated POC SSM namespace (/medconsult/poc/prompts/*).
 * GET  → all prompts (SSM value or bundled default + which one).
 * POST → save one prompt to its test SSM parameter ({ key, value }).
 * This is the real admin mechanism (read/write SSM) but pointed at TEST params, so it
 * persists across reloads without touching the deployed backend.
 */
export async function GET() {
  try {
    const prompts = await readAllPrompts()
    return NextResponse.json({ prompts })
  } catch (error) {
    console.error('GET /api/prompts error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudieron leer los prompts' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const { key, value } = await req.json()
    if (!PROMPT_KEYS.includes(key)) {
      return NextResponse.json({ error: `key inválida: ${key}` }, { status: 400 })
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      return NextResponse.json({ error: 'value (string no vacío) es requerido' }, { status: 400 })
    }
    await writePrompt(key as PromptKey, value)
    return NextResponse.json({ ok: true, key })
  } catch (error) {
    console.error('POST /api/prompts error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo guardar el prompt' },
      { status: 500 }
    )
  }
}
