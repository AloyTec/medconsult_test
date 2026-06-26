import { NextResponse } from 'next/server'
import { TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'

/**
 * Mints short-lived AWS credentials for the browser to open an Amazon Transcribe
 * streaming WebSocket directly. The server resolves its identity's creds (SSO locally,
 * the scoped OIDC role on Vercel) and returns them.
 *
 * Scope note: these are the *server identity's* temp creds. On the deploy the OIDC role
 * is minimal (Bedrock + SSM /medconsult/poc/* + Transcribe), so the browser only ever
 * holds that limited, ~1h scope. For tighter scoping, re-assume a Transcribe-only role
 * with a session policy (needs IAM admin — see infra/vercel-aws-oidc.md).
 */
export async function GET() {
  try {
    const client = new TranscribeStreamingClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.AWS_ROLE_ARN
        ? { credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }) }
        : {}),
    })

    const creds = await client.config.credentials()

    return NextResponse.json({
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
      expiration: creds.expiration,
      region: process.env.AWS_REGION || 'us-east-1',
      // Optional Transcribe custom vocabulary (created offline; see infra/transcribe-vocabulary/).
      // Null until TRANSCRIBE_VOCABULARY_NAME is set in the env → Transcribe runs without it.
      vocabularyName: process.env.TRANSCRIBE_VOCABULARY_NAME || null,
    })
  } catch (error) {
    console.error('aws-stt-creds error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudieron obtener credenciales AWS' },
      { status: 500 }
    )
  }
}
