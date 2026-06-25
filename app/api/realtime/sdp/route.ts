import { NextRequest, NextResponse } from 'next/server'

/**
 * Server-side proxy for the OpenAI Realtime WebRTC SDP exchange.
 *
 * The browser sends its SDP *offer*; this route forwards it to OpenAI's
 * /v1/realtime/calls with the API key + the session config, and returns the SDP
 * *answer*. The audio + transcript events then flow peer-to-peer (browser ↔ OpenAI)
 * over WebRTC — the key never reaches the browser.
 *
 * Mirrors the Flutter app exactly (openai_realtime_webrtc_service.dart:113-145):
 * model gpt-realtime-2, text-only output, Spanish transcription via gpt-4o-mini-transcribe.
 */
const SESSION = {
  type: 'realtime',
  model: 'gpt-realtime-2',
  output_modalities: ['text'],
  audio: {
    input: {
      transcription: { language: 'es', model: 'gpt-4o-mini-transcribe' },
    },
  },
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY no está configurada en el servidor' },
      { status: 500 }
    )
  }

  const { sdp } = await req.json()
  if (!sdp || typeof sdp !== 'string') {
    return NextResponse.json({ error: 'Falta el SDP offer.' }, { status: 400 })
  }

  const form = new FormData()
  form.append('sdp', sdp)
  form.append('session', JSON.stringify(SESSION))

  try {
    const res = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })

    const body = await res.text()
    if (!res.ok) {
      console.error('Realtime /calls failed:', res.status, body.slice(0, 300))
      return NextResponse.json(
        { error: `La conexión Realtime falló (${res.status}).` },
        { status: res.status }
      )
    }

    // body is the SDP answer
    return new NextResponse(body, {
      status: 200,
      headers: { 'Content-Type': 'application/sdp' },
    })
  } catch (error) {
    console.error('Realtime SDP proxy error:', error)
    return NextResponse.json(
      { error: 'No se pudo contactar a OpenAI Realtime.' },
      { status: 502 }
    )
  }
}
