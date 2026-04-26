import { NextResponse } from 'next/server'

/**
 * Server-side API route to get an ephemeral token from OpenAI.
 * Matches Flutter session config: text-only output, Spanish transcription.
 */
export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY not configured on server' },
      { status: 500 }
    )
  }

  try {
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: 'gpt-4o-realtime-preview',
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenAI session creation failed:', response.status, errorText)
      return NextResponse.json(
        { error: `OpenAI API error: ${response.status} ${errorText}` },
        { status: response.status }
      )
    }

    const data = await response.json()

    // Handle both response formats: { client_secret: "ek_..." } or { client_secret: { value, expires_at } }
    const token = typeof data.client_secret === 'string'
      ? data.client_secret
      : data.client_secret?.value ?? data.value

    if (!token) {
      console.error('No client_secret in response:', JSON.stringify(data))
      return NextResponse.json(
        { error: 'No client_secret in OpenAI response' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      token,
      expires_at: data.expires_at ?? data.client_secret?.expires_at,
    })
  } catch (error) {
    console.error('Error creating realtime session:', error)
    return NextResponse.json(
      { error: 'Failed to create realtime session' },
      { status: 500 }
    )
  }
}
