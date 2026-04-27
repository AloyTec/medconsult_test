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
    const tokenRequestBody = {
      model: 'gpt-4o-realtime-preview',
      voice: 'alloy',
    }
    console.log('🔍 [DEBUG] Token request body:', JSON.stringify(tokenRequestBody))

    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: JSON.stringify(tokenRequestBody),
    })

    console.log('🔍 [DEBUG] Token response status:', response.status, response.statusText)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenAI session creation failed:', response.status, errorText)
      return NextResponse.json(
        { error: `OpenAI API error: ${response.status} ${errorText}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    console.log('🔍 [DEBUG] Full OpenAI token response:', JSON.stringify(data, null, 2))

    const token = data.client_secret?.value

    if (!token) {
      console.error('No client_secret in response:', JSON.stringify(data))
      return NextResponse.json(
        { error: 'No client_secret in OpenAI response' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      token,
      expires_at: data.client_secret?.expires_at,
    })
  } catch (error) {
    console.error('Error creating realtime session:', error)
    return NextResponse.json(
      { error: 'Failed to create realtime session' },
      { status: 500 }
    )
  }
}
