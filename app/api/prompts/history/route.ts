import { NextRequest, NextResponse } from 'next/server'
import { readPromptHistory, PROMPT_KEYS, type PromptKey } from '@/lib/ssm-prompts'

/**
 * Version history for a prompt (SSM auto-versions on every save). Newest first.
 * GET /api/prompts/history?key=extraction → { versions: [{ version, lastModified, value }] }
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key') ?? 'extraction'
  if (!PROMPT_KEYS.includes(key as PromptKey)) {
    return NextResponse.json({ error: `key inválida: ${key}` }, { status: 400 })
  }

  try {
    const versions = (await readPromptHistory(key as PromptKey)).map((v) => ({
      version: v.version,
      // "2026-06-25 22:31 UTC" — readable + unambiguous, no locale dependency.
      lastModified: v.lastModified ? `${v.lastModified.slice(0, 16).replace('T', ' ')} UTC` : '',
      value: v.value,
    }))
    return NextResponse.json({ versions })
  } catch (error) {
    console.error('GET /api/prompts/history error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo leer el historial' },
      { status: 500 }
    )
  }
}
