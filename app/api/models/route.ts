import { NextResponse } from 'next/server'

/**
 * Lists OpenAI models so the client can pick which one the extraction uses.
 * Runs server-side (the API key never reaches the browser). Filtered to the
 * text/chat-capable models that can drive /v1/responses extraction, and sorted.
 */
export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY no está configurada' }, { status: 500 })
  }

  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      return NextResponse.json(
        { error: `OpenAI /models falló (${res.status})` },
        { status: res.status }
      )
    }

    const data = await res.json()
    const ids: string[] = Array.isArray(data?.data)
      ? data.data.map((m: { id: string }) => m.id)
      : []

    // Keep gpt-* and the o-series reasoning models; drop audio/realtime/embeddings/
    // image/tts/moderation/search variants that can't do text extraction.
    const models = ids
      .filter((id) => /^(gpt-|o1|o3|o4|chatgpt)/.test(id))
      .filter(
        (id) => !/(audio|realtime|transcribe|tts|image|embedding|moderation|search)/.test(id)
      )
      .sort()

    return NextResponse.json({ models })
  } catch (error) {
    console.error('GET /api/models error:', error)
    return NextResponse.json(
      { error: 'No se pudieron listar los modelos de OpenAI' },
      { status: 500 }
    )
  }
}
