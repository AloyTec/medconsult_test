# Flutter Parity Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Next.js medconsult_voice_testing app so its real-time voice transcription and clinical data extraction match the Flutter reference implementation exactly.

**Architecture:** The Flutter app uses WebRTC to stream audio to OpenAI Realtime API (transcription only, no audio output). Transcripts accumulate in a buffer. After a 2-second debounce, a separate `POST /v1/responses` call with `gpt-4o-mini` and JSON schema extracts structured clinical data. The Next.js app must replicate this two-stage pipeline: Realtime for transcription, Responses API for extraction.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, OpenAI Realtime API (WebRTC), OpenAI Responses API (`gpt-4o-mini`), Zod 4, Tailwind CSS 4

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `app/api/realtime-token/route.ts` | Modify | Fix session config: text-only output, Spanish transcription, correct model |
| `lib/openai-realtime.ts` | Modify | Fix event names, remove audio output handling, remove inline JSON extraction |
| `lib/clinical-extraction.ts` | Create | Separate clinical extraction via `POST /v1/responses` with debounce |
| `app/api/extract/route.ts` | Create | Server-side proxy for extraction API call (keeps API key secure) |
| `lib/extraction-schema.ts` | Rewrite | Match Flutter's Spanish schema, prompt, and nullable field pattern |
| `lib/types.ts` | Modify | Match Flutter's data model (Spanish section names, nullable fields, docType) |
| `lib/hooks/useVoiceRecording.ts` | Modify | Integrate extraction service, fix timer bug |
| `app/components/DataExtraction.tsx` | Modify | Match Flutter's Spanish field names |
| `.env.example` | Modify | Fix env var name |
| `lib/openai-token-service.ts` | Delete | Dead code |
| `lib/audio-capture.ts` | Delete | Dead code (WebRTC handles audio) |
| `__tests__/audio-capture.test.ts` | Delete | Tests for dead code |
| `__tests__/extraction-schema.test.ts` | Modify | Update for new schema |

---

### Task 1: Fix types to match Flutter data model

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Rewrite types.ts to match Flutter's data model**

Replace the entire contents of `lib/types.ts` with:

```typescript
// lib/types.ts

export interface PatientData {
  name: string | null
  lastName: string | null
  age: number | null
  document: string | null // Normalized: no dots, no dashes
  docType: number | null // 0=anonymous, 1=RUT, 3=passport
}

export interface ClinicalSections {
  antecedentes: string | null // Medical history
  anamnesis: string | null // Consultation reason / current illness
  examenFisico: string | null // Physical examination
  diagnostico: string | null // Diagnosis
  plan: string | null // Treatment plan
}

export interface ExtractedData {
  patient: PatientData
  clinicalSections: ClinicalSections
}

export interface RecordingState {
  isRecording: boolean
  isPaused: boolean
  liveTranscript: string
  fullTranscript: string
  extractedData: ExtractedData | null
  error: string | null
  isProcessing: boolean
  isExtracting: boolean
  elapsedSeconds: number
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd "/Users/tilenciam/ALOY_TECH/Medconsult v1.0/medconsult_voice_testing" && npx tsc --noEmit lib/types.ts`
Expected: No errors (this file has no imports to resolve, so isolated check works)

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "refactor: align types with Flutter data model (Spanish clinical fields, nullable patient data)"
```

---

### Task 2: Rewrite extraction schema to match Flutter

**Files:**
- Modify: `lib/extraction-schema.ts`

- [ ] **Step 1: Rewrite extraction-schema.ts**

Replace the entire contents of `lib/extraction-schema.ts` with:

```typescript
// lib/extraction-schema.ts

/**
 * Clinical data extraction schema and prompt — matches Flutter implementation exactly.
 * Used with OpenAI Responses API (POST /v1/responses) for structured output.
 */

export const EXTRACTION_PROMPT = `Eres un asistente clínico especializado en documentación médica en Chile.

A partir de la transcripción del médico:
- Extrae información estructurada del paciente.
- Extrae información clínica SOLO si el médico la menciona explícitamente.
- No inventes diagnósticos, exámenes ni planes.
- Si una sección no ha sido mencionada, devuélvela como null.
- Si el médico habla en forma narrativa, resume clínicamente en lenguaje médico.

Documento del paciente:
- Extrae \`document\` y \`docType\` si el médico lo menciona.
- \`docType\`: 0=anónimo (sin documento o se autogenera), 1=RUT, 3=pasaporte.
- \`document\` debe venir SIN puntos, SIN guiones y SIN espacios.
- Para RUT: retorna solo dígitos (y letra K si corresponde). Si se menciona con puntos/guión, normalízalo.
- Para pasaporte: puede contener letras y números; normaliza a mayúsculas y sin separadores.
- Si no se menciona documento, devuelve \`document: null\` y \`docType: null\`.

Secciones clínicas:
- antecedentes: enfermedades previas, cirugías, hábitos.
- anamnesis: motivo de consulta e historia actual.
- examenFisico: hallazgos del examen físico.
- diagnostico: diagnósticos o hipótesis clínicas.
- plan: indicaciones, exámenes, tratamiento, seguimiento.

Corrige errores fonéticos comunes de transcripción.
Convierte números hablados en números reales.

Devuelve SOLO JSON válido.`

export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    patient: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: ['string', 'null'] },
        lastName: { type: ['string', 'null'] },
        age: { type: ['number', 'null'] },
        document: { type: ['string', 'null'] },
        docType: { type: ['number', 'null'], enum: [0, 1, 3, null] },
      },
      required: ['name', 'lastName', 'age', 'document', 'docType'],
    },
    clinicalSections: {
      type: 'object',
      additionalProperties: false,
      properties: {
        antecedentes: { type: ['string', 'null'] },
        anamnesis: { type: ['string', 'null'] },
        examenFisico: { type: ['string', 'null'] },
        diagnostico: { type: ['string', 'null'] },
        plan: { type: ['string', 'null'] },
      },
      required: ['antecedentes', 'anamnesis', 'examenFisico', 'diagnostico', 'plan'],
    },
  },
  required: ['patient', 'clinicalSections'],
} as const
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd "/Users/tilenciam/ALOY_TECH/Medconsult v1.0/medconsult_voice_testing" && npx tsc --noEmit lib/extraction-schema.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/extraction-schema.ts
git commit -m "refactor: match Flutter extraction schema and Spanish clinical prompt"
```

---

### Task 3: Fix API route session config

**Files:**
- Modify: `app/api/realtime-token/route.ts`

The session config must match Flutter: text-only output, Spanish transcription with `gpt-4o-mini-transcribe`, model `gpt-4o-realtime-preview`.

- [ ] **Step 1: Rewrite the API route**

Replace the entire contents of `app/api/realtime-token/route.ts` with:

```typescript
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
    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview',
        output_modalities: ['text'],
        input_audio_transcription: {
          model: 'gpt-4o-mini-transcribe',
          language: 'es',
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
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

    if (!data.client_secret?.value) {
      console.error('No client_secret in response:', JSON.stringify(data))
      return NextResponse.json(
        { error: 'No client_secret in OpenAI response' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      token: data.client_secret.value,
      expires_at: data.client_secret.expires_at,
    })
  } catch (error) {
    console.error('Error creating realtime session:', error)
    return NextResponse.json(
      { error: 'Failed to create realtime session' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd "/Users/tilenciam/ALOY_TECH/Medconsult v1.0/medconsult_voice_testing" && npx next build`
Expected: Build succeeds (there will be type errors in other files — that's expected, we fix those next)

- [ ] **Step 3: Commit**

```bash
git add app/api/realtime-token/route.ts
git commit -m "fix: session config matches Flutter — text-only output, Spanish transcription, gpt-4o-mini-transcribe"
```

---

### Task 4: Create extraction API route

**Files:**
- Create: `app/api/extract/route.ts`

This server-side route calls OpenAI's Responses API for structured clinical extraction. Keeps the API key secure on the server.

- [ ] **Step 1: Create the directory**

```bash
mkdir -p "/Users/tilenciam/ALOY_TECH/Medconsult v1.0/medconsult_voice_testing/app/api/extract"
```

- [ ] **Step 2: Write the route**

Create `app/api/extract/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { EXTRACTION_PROMPT, EXTRACTION_SCHEMA } from '@/lib/extraction-schema'

/**
 * Server-side proxy for clinical data extraction.
 * Calls OpenAI Responses API with gpt-4o-mini and JSON schema.
 * Matches Flutter's extractStructuredData() exactly.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY not configured' },
      { status: 500 }
    )
  }

  const { transcript } = await req.json()

  if (!transcript || typeof transcript !== 'string') {
    return NextResponse.json(
      { error: 'transcript is required' },
      { status: 400 }
    )
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: transcript,
        instructions: EXTRACTION_PROMPT,
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
```

- [ ] **Step 3: Commit**

```bash
git add app/api/extract/route.ts
git commit -m "feat: add server-side extraction API route using OpenAI Responses API with gpt-4o-mini"
```

---

### Task 5: Create clinical extraction service with debounce

**Files:**
- Create: `lib/clinical-extraction.ts`

This module accumulates transcript segments and triggers extraction after a 2-second debounce, matching Flutter's behavior.

- [ ] **Step 1: Write the extraction service**

Create `lib/clinical-extraction.ts`:

```typescript
// lib/clinical-extraction.ts
import type { ExtractedData } from './types'

/**
 * Clinical data extraction service.
 * Accumulates transcript segments, debounces 2s, then calls extraction API.
 * Matches Flutter's ClinicalRecordingCubit extraction pattern.
 */
export class ClinicalExtractionService {
  private buffer: string = ''
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private jobId: number = 0
  private onExtracted: ((data: ExtractedData) => void) | null = null
  private onExtracting: ((isExtracting: boolean) => void) | null = null

  constructor(
    onExtracted: (data: ExtractedData) => void,
    onExtracting: (isExtracting: boolean) => void
  ) {
    this.onExtracted = onExtracted
    this.onExtracting = onExtracting
  }

  /**
   * Add a transcript segment to the buffer and schedule extraction.
   */
  addTranscript(text: string): void {
    this.buffer = (this.buffer + ' ' + text).trim()

    // Reset debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    // Schedule extraction after 2 seconds of silence
    this.debounceTimer = setTimeout(() => {
      this.extract()
    }, 2000)
  }

  /**
   * Call the extraction API with the accumulated buffer.
   */
  private async extract(): Promise<void> {
    if (!this.buffer.trim()) return

    const currentJobId = ++this.jobId
    this.onExtracting?.(true)

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: this.buffer }),
      })

      // Stale check: a newer extraction has been triggered
      if (currentJobId !== this.jobId) return

      if (!response.ok) {
        console.error('Extraction failed:', response.status)
        return
      }

      const data: ExtractedData = await response.json()
      this.onExtracted?.(data)
    } catch (error) {
      console.error('Extraction error:', error)
    } finally {
      if (currentJobId === this.jobId) {
        this.onExtracting?.(false)
      }
    }
  }

  /**
   * Get the current buffer content.
   */
  getBuffer(): string {
    return this.buffer
  }

  /**
   * Clean up timers.
   */
  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.onExtracted = null
    this.onExtracting = null
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/clinical-extraction.ts
git commit -m "feat: add clinical extraction service with 2s debounce matching Flutter"
```

---

### Task 6: Fix openai-realtime.ts — event names, remove audio output, remove inline extraction

**Files:**
- Modify: `lib/openai-realtime.ts`

Key changes:
1. Remove `onExtractedData` callback (extraction is now separate)
2. Remove `validateExtractedData` import
3. Remove audio output element (text-only mode)
4. Fix event name `response.audio_transcript.delta` → `response.output_audio_transcript.delta`
5. Remove `response.done` JSON parsing logic

- [ ] **Step 1: Rewrite openai-realtime.ts**

Replace the entire contents of `lib/openai-realtime.ts` with:

```typescript
// lib/openai-realtime.ts

/**
 * OpenAI Realtime Client using WebRTC
 *
 * Handles ONLY real-time transcription via WebRTC.
 * Clinical data extraction is handled separately by ClinicalExtractionService.
 *
 * Flow:
 * 1. Server-side API route gets ephemeral token (text-only, Spanish transcription)
 * 2. Browser establishes WebRTC peer connection with token
 * 3. Audio flows through WebRTC media tracks
 * 4. Transcription events arrive via RTCDataChannel
 */
export class OpenAIRealtimeClient {
  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private sessionId: string = ''
  private onTranscript: ((text: string) => void) | null = null
  private onError: ((error: string) => void) | null = null
  private isConnected: boolean = false

  /**
   * Connect to OpenAI Realtime API via WebRTC
   */
  async connect(
    onTranscript: (text: string) => void,
    onError: (error: string) => void
  ): Promise<MediaStream> {
    if (this.isConnected) {
      throw new Error('Already connected to OpenAI Realtime API')
    }

    this.onTranscript = onTranscript
    this.onError = onError

    // Step 1: Get ephemeral token from our server-side API route
    console.log('🔑 Step 1/3: Getting ephemeral token from server...')
    let token: string
    try {
      const tokenRes = await fetch('/api/realtime-token', { method: 'POST' })
      if (!tokenRes.ok) {
        const err = await tokenRes.json()
        throw new Error(err.error || `Token request failed: ${tokenRes.status}`)
      }
      const tokenData = await tokenRes.json()
      token = tokenData.token
      console.log('✅ Ephemeral token acquired, expires:', tokenData.expires_at)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to get token'
      console.error('❌ Token error:', msg)
      this.onError?.(msg)
      throw error
    }

    // Step 2: Create WebRTC peer connection
    console.log('🔗 Step 2/3: Creating WebRTC peer connection...')
    this.pc = new RTCPeerConnection()

    // No audio output element needed — text-only mode (matching Flutter)

    // Get microphone audio and add to peer connection
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    mediaStream.getTracks().forEach((track) => {
      this.pc!.addTrack(track, mediaStream)
      console.log('🎤 Added local audio track:', track.kind)
    })

    // Monitor ICE connection state
    this.pc.oniceconnectionstatechange = () => {
      console.log('🧊 ICE state:', this.pc?.iceConnectionState)
    }
    this.pc.onconnectionstatechange = () => {
      console.log('🔗 Connection state:', this.pc?.connectionState)
    }

    // Create data channel for events
    this.dc = this.pc.createDataChannel('oai-events')
    this.setupDataChannel(this.dc)

    // Also listen for server-created data channels
    this.pc.ondatachannel = (event) => {
      console.log('📡 Received server data channel:', event.channel.label)
      this.dc = event.channel
      this.setupDataChannel(this.dc)
    }

    // Step 3: SDP exchange with OpenAI
    console.log('📡 Step 3/3: SDP offer/answer exchange...')
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)

    const sdpResponse = await fetch(
      'https://api.openai.com/v1/realtime/calls',
      {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/sdp',
        },
      }
    )

    if (!sdpResponse.ok) {
      const errText = await sdpResponse.text()
      const msg = `SDP exchange failed: ${sdpResponse.status} ${errText}`
      console.error('❌', msg)
      this.onError?.(msg)
      throw new Error(msg)
    }

    const answerSdp = await sdpResponse.text()
    console.log('✅ SDP answer received')

    await this.pc.setRemoteDescription({
      type: 'answer',
      sdp: answerSdp,
    })

    console.log('✅ WebRTC connection established!')
    return mediaStream
  }

  /**
   * Send an event via data channel
   */
  sendEvent(event: Record<string, unknown>): void {
    if (!this.dc || this.dc.readyState !== 'open') {
      console.warn('⚠️ Data channel not ready')
      return
    }
    this.dc.send(JSON.stringify(event))
  }

  /**
   * Set up data channel event handlers
   */
  private setupDataChannel(dc: RTCDataChannel): void {
    dc.onopen = () => {
      console.log('✅ Data channel open — connection ready!')
      this.isConnected = true
    }
    dc.onmessage = (event) => {
      this.handleMessage(event.data)
    }
    dc.onclose = () => {
      console.log('📴 Data channel closed')
      this.isConnected = false
    }
    dc.onerror = (event) => {
      console.error('❌ Data channel error:', event)
    }
  }

  /**
   * Handle incoming events from OpenAI via data channel.
   * Only processes transcription-related events.
   */
  private handleMessage(data: string): void {
    try {
      const event = JSON.parse(data)

      switch (event.type) {
        case 'session.created':
          this.sessionId = event.session?.id || ''
          console.log('✅ Session created:', this.sessionId)
          break

        case 'session.updated':
          console.log('✅ Session updated')
          break

        case 'input_audio_buffer.speech_started':
          console.log('🎤 Speech detected')
          break

        case 'input_audio_buffer.speech_stopped':
          console.log('🤐 Speech stopped')
          break

        case 'conversation.item.input_audio_transcription.completed':
          if (event.transcript) {
            console.log('📝 Transcript:', event.transcript)
            this.onTranscript?.(event.transcript)
          }
          break

        case 'conversation.item.input_audio_transcription.failed':
          console.error('❌ Transcription failed:', event.error)
          break

        case 'error':
          if (event.error) {
            const errorMsg = `${event.error.code || event.error.type}: ${event.error.message}`
            console.error('❌ OpenAI error:', errorMsg)
            this.onError?.(errorMsg)
          }
          break

        default:
          // Silently ignore audio/response events (text-only mode)
          break
      }
    } catch (error) {
      console.error('❌ Error parsing message:', error)
    }
  }

  /**
   * Disconnect and clean up
   */
  disconnect(): void {
    if (this.dc) {
      this.dc.close()
      this.dc = null
    }
    if (this.pc) {
      this.pc.close()
      this.pc = null
    }
    this.isConnected = false
    console.log('🔌 Disconnected')
  }

  getIsConnected(): boolean {
    return this.isConnected
  }

  getSessionId(): string {
    return this.sessionId
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/openai-realtime.ts
git commit -m "fix: text-only transcription mode, correct event names, remove inline extraction"
```

---

### Task 7: Update useVoiceRecording hook — integrate extraction, fix timer

**Files:**
- Modify: `lib/hooks/useVoiceRecording.ts`

Key changes:
1. Integrate `ClinicalExtractionService` for debounced extraction
2. Fix timer closure bug in `resume` (use setState callback)
3. Update `connect()` signature (removed `onExtractedData` param)
4. Add `isExtracting` state

- [ ] **Step 1: Rewrite useVoiceRecording.ts**

Replace the entire contents of `lib/hooks/useVoiceRecording.ts` with:

```typescript
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { OpenAIRealtimeClient } from '../openai-realtime'
import { ClinicalExtractionService } from '../clinical-extraction'
import type { RecordingState } from '../types'

export function useVoiceRecording() {
  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    liveTranscript: '',
    fullTranscript: '',
    extractedData: null,
    error: null,
    isProcessing: false,
    isExtracting: false,
    elapsedSeconds: 0,
  })

  const openaiRef = useRef<OpenAIRealtimeClient | null>(null)
  const extractionRef = useRef<ClinicalExtractionService | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /**
   * Start recording — connects to OpenAI via WebRTC
   */
  const start = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, error: null, isProcessing: true }))

      // Initialize extraction service
      extractionRef.current = new ClinicalExtractionService(
        (data) => {
          setState((prev) => ({ ...prev, extractedData: data }))
        },
        (isExtracting) => {
          setState((prev) => ({ ...prev, isExtracting }))
        }
      )

      // Initialize WebRTC client
      openaiRef.current = new OpenAIRealtimeClient()

      const mediaStream = await openaiRef.current.connect(
        (text) => {
          // Append transcript and feed to extraction service
          setState((prev) => ({
            ...prev,
            liveTranscript: text,
            fullTranscript: (prev.fullTranscript + ' ' + text).trim(),
          }))
          extractionRef.current?.addTranscript(text)
        },
        (error) => {
          setState((prev) => ({
            ...prev,
            error,
            isRecording: false,
          }))
        }
      )

      mediaStreamRef.current = mediaStream

      // Start timer — uses setState callback to avoid closure bugs
      timerRef.current = setInterval(() => {
        setState((prev) => ({ ...prev, elapsedSeconds: prev.elapsedSeconds + 1 }))
      }, 1000)

      setState((prev) => ({
        ...prev,
        isRecording: true,
        isPaused: false,
        isProcessing: false,
      }))
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to start recording',
        isProcessing: false,
      }))
    }
  }, [])

  /**
   * Stop recording
   */
  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    openaiRef.current?.disconnect()
    openaiRef.current = null

    extractionRef.current?.destroy()
    extractionRef.current = null

    setState((prev) => ({
      ...prev,
      isRecording: false,
      isPaused: false,
    }))
  }, [])

  /**
   * Pause recording (mute mic tracks)
   */
  const pause = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = false
      })
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setState((prev) => ({ ...prev, isPaused: true }))
  }, [])

  /**
   * Resume recording (unmute mic tracks)
   */
  const resume = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = true
      })
    }
    // Fixed: use setState callback instead of closure variable
    timerRef.current = setInterval(() => {
      setState((prev) => ({ ...prev, elapsedSeconds: prev.elapsedSeconds + 1 }))
    }, 1000)
    setState((prev) => ({ ...prev, isPaused: false }))
  }, [])

  /**
   * Clear transcript and extracted data
   */
  const clear = useCallback(() => {
    setState((prev) => ({
      ...prev,
      liveTranscript: '',
      fullTranscript: '',
      extractedData: null,
      elapsedSeconds: 0,
    }))
  }, [])

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      openaiRef.current?.disconnect()
      extractionRef.current?.destroy()
    }
  }, [])

  return {
    state,
    start,
    stop,
    pause,
    resume,
    clear,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/hooks/useVoiceRecording.ts
git commit -m "feat: integrate extraction service with 2s debounce, fix timer closure bug"
```

---

### Task 8: Update DataExtraction component for Spanish fields

**Files:**
- Modify: `app/components/DataExtraction.tsx`

- [ ] **Step 1: Rewrite DataExtraction.tsx**

Replace the entire contents of `app/components/DataExtraction.tsx` with:

```tsx
'use client'

import type { ExtractedData } from '@/lib/types'

interface Props {
  extractedData: ExtractedData | null
  isExtracting: boolean
}

const SECTION_LABELS: Record<string, string> = {
  antecedentes: 'Antecedentes',
  anamnesis: 'Anamnesis',
  examenFisico: 'Examen Físico',
  diagnostico: 'Diagnóstico',
  plan: 'Plan de Tratamiento',
}

const DOC_TYPE_LABELS: Record<number, string> = {
  0: 'Anónimo',
  1: 'RUT',
  3: 'Pasaporte',
}

export function DataExtraction({ extractedData, isExtracting }: Props) {
  if (!extractedData) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Datos Clínicos Extraídos
        </h3>
        <p className="text-center text-gray-500 py-8">
          {isExtracting
            ? 'Extrayendo datos clínicos...'
            : 'Los datos estructurados aparecerán aquí después del procesamiento'}
        </p>
      </div>
    )
  }

  const { patient, clinicalSections } = extractedData

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          Datos Clínicos Extraídos
        </h3>
        {isExtracting && (
          <span className="text-xs text-blue-600 font-medium">
            Actualizando...
          </span>
        )}
      </div>

      <div className="space-y-4">
        {/* Patient Data */}
        <div className="rounded-lg bg-green-50 p-4 border border-green-200">
          <h4 className="font-semibold text-green-900 mb-2">Datos del Paciente</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-xs text-gray-600">Nombre</p>
              <p className="font-medium text-gray-900">
                {patient.name ?? '—'} {patient.lastName ?? ''}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-600">Edad</p>
              <p className="font-medium text-gray-900">
                {patient.age != null ? `${patient.age} años` : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-600">Documento</p>
              <p className="font-medium text-gray-900">
                {patient.document ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-600">Tipo</p>
              <p className="font-medium text-gray-900">
                {patient.docType != null
                  ? DOC_TYPE_LABELS[patient.docType] ?? String(patient.docType)
                  : '—'}
              </p>
            </div>
          </div>
        </div>

        {/* Clinical Sections */}
        <div className="space-y-3">
          {Object.entries(clinicalSections).map(([key, value]) => (
            <div
              key={key}
              className="rounded-lg bg-gray-50 p-3 border border-gray-200"
            >
              <p className="text-xs font-semibold text-gray-700 mb-1">
                {SECTION_LABELS[key] ?? key}
              </p>
              <p className="text-sm text-gray-900">
                {value ?? <span className="text-gray-400 italic">No mencionado</span>}
              </p>
            </div>
          ))}
        </div>

        {/* JSON Preview */}
        <details className="rounded-lg border border-gray-300">
          <summary className="cursor-pointer p-3 font-semibold text-gray-700 hover:bg-gray-50">
            JSON Preview
          </summary>
          <pre className="overflow-x-auto bg-gray-900 text-gray-100 p-4 text-xs">
            {JSON.stringify(extractedData, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update VoiceRecorder.tsx to pass isExtracting prop**

In `app/components/VoiceRecorder.tsx`, change the DataExtraction usage from:

```tsx
      <DataExtraction extractedData={state.extractedData} />
```

to:

```tsx
      <DataExtraction extractedData={state.extractedData} isExtracting={state.isExtracting} />
```

- [ ] **Step 3: Commit**

```bash
git add app/components/DataExtraction.tsx app/components/VoiceRecorder.tsx
git commit -m "feat: Spanish clinical data display matching Flutter UI"
```

---

### Task 9: Delete dead code and fix .env.example

**Files:**
- Delete: `lib/openai-token-service.ts`
- Delete: `lib/audio-capture.ts`
- Delete: `__tests__/audio-capture.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Delete dead files**

```bash
cd "/Users/tilenciam/ALOY_TECH/Medconsult v1.0/medconsult_voice_testing"
rm lib/openai-token-service.ts
rm lib/audio-capture.ts
rm __tests__/audio-capture.test.ts
```

- [ ] **Step 2: Fix .env.example**

Replace contents of `.env.example` with:

```
OPENAI_API_KEY=your_api_key_here
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove dead code (token-service, audio-capture), fix .env.example"
```

---

### Task 10: Update extraction tests for new schema

**Files:**
- Modify: `__tests__/extraction-schema.test.ts`

- [ ] **Step 1: Rewrite extraction-schema.test.ts**

Replace the entire contents of `__tests__/extraction-schema.test.ts` with:

```typescript
// __tests__/extraction-schema.test.ts
import { EXTRACTION_PROMPT, EXTRACTION_SCHEMA } from '@/lib/extraction-schema'

describe('extraction-schema', () => {
  it('should have a non-empty extraction prompt in Spanish', () => {
    expect(EXTRACTION_PROMPT).toContain('clínico')
    expect(EXTRACTION_PROMPT).toContain('Chile')
    expect(EXTRACTION_PROMPT).toContain('antecedentes')
    expect(EXTRACTION_PROMPT.length).toBeGreaterThan(100)
  })

  it('should have patient and clinicalSections as required top-level fields', () => {
    expect(EXTRACTION_SCHEMA.required).toEqual(['patient', 'clinicalSections'])
  })

  it('should have correct patient fields', () => {
    const patientProps = EXTRACTION_SCHEMA.properties.patient.properties
    expect(patientProps).toHaveProperty('name')
    expect(patientProps).toHaveProperty('lastName')
    expect(patientProps).toHaveProperty('age')
    expect(patientProps).toHaveProperty('document')
    expect(patientProps).toHaveProperty('docType')
  })

  it('should have correct clinical section fields in Spanish', () => {
    const sectionProps = EXTRACTION_SCHEMA.properties.clinicalSections.properties
    expect(sectionProps).toHaveProperty('antecedentes')
    expect(sectionProps).toHaveProperty('anamnesis')
    expect(sectionProps).toHaveProperty('examenFisico')
    expect(sectionProps).toHaveProperty('diagnostico')
    expect(sectionProps).toHaveProperty('plan')
  })

  it('should allow null values for all patient fields', () => {
    const patientProps = EXTRACTION_SCHEMA.properties.patient.properties
    for (const [, value] of Object.entries(patientProps)) {
      const prop = value as { type: string | string[] }
      const types = Array.isArray(prop.type) ? prop.type : [prop.type]
      expect(types).toContain('null')
    }
  })

  it('should allow null values for all clinical section fields', () => {
    const sectionProps = EXTRACTION_SCHEMA.properties.clinicalSections.properties
    for (const [, value] of Object.entries(sectionProps)) {
      const prop = value as { type: string | string[] }
      const types = Array.isArray(prop.type) ? prop.type : [prop.type]
      expect(types).toContain('null')
    }
  })

  it('should restrict docType to valid enum values', () => {
    const docType = EXTRACTION_SCHEMA.properties.patient.properties.docType
    expect(docType.enum).toEqual([0, 1, 3, null])
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd "/Users/tilenciam/ALOY_TECH/Medconsult v1.0/medconsult_voice_testing" && npx jest __tests__/extraction-schema.test.ts --verbose`
Expected: All 7 tests PASS

- [ ] **Step 3: Commit**

```bash
git add __tests__/extraction-schema.test.ts
git commit -m "test: update extraction schema tests for Flutter-matching Spanish schema"
```

---

### Task 11: Full build verification

- [ ] **Step 1: Run full build**

```bash
cd "/Users/tilenciam/ALOY_TECH/Medconsult v1.0/medconsult_voice_testing" && npm run build
```

Expected: Build succeeds with routes `/`, `/_not-found`, `/api/realtime-token`, `/api/extract`

- [ ] **Step 2: Run all tests**

```bash
cd "/Users/tilenciam/ALOY_TECH/Medconsult v1.0/medconsult_voice_testing" && npm test
```

Expected: All tests pass

- [ ] **Step 3: Manual smoke test**

Start dev server: `npm run dev`

Open browser to `http://localhost:3000`. Click "Start Recording":

1. Console should show: `🔑 Step 1/3: Getting ephemeral token from server...`
2. Console should show: `✅ Ephemeral token acquired`
3. Console should show: `✅ SDP answer received`
4. Console should show: `✅ Data channel open — connection ready!`
5. Speak into microphone — console should show: `📝 Transcript: [your words]`
6. After 2 seconds of silence, console should show extraction API call
7. "Datos Clínicos Extraídos" section should populate with structured data

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "build: verify full build and test suite pass"
```

---

## Summary of Changes

| What | Before (Broken) | After (Matches Flutter) |
|------|-----------------|-------------------------|
| Output modalities | `["audio", "text"]` | `["text"]` |
| Transcription model | `whisper-1` | `gpt-4o-mini-transcribe` |
| Transcription language | Not set | `"es"` (Spanish) |
| Clinical extraction | Inline JSON parsing from Realtime events | Separate `POST /v1/responses` with `gpt-4o-mini` + JSON schema |
| Extraction debounce | None | 2 seconds |
| Extraction prompt | English, generic | Spanish, Chile-specific, matching Flutter |
| Data model fields | English (`consultationReason`, `medicalHistory`) | Spanish (`anamnesis`, `antecedentes`, `examenFisico`) |
| Patient document | `rut` only | `document` + `docType` (0=anon, 1=RUT, 3=passport) |
| Event names | `response.audio_transcript.delta` (wrong) | Removed — text-only mode |
| Timer bug | Closure captures wrong value | Uses `setState` callback |
| Dead code | `openai-token-service.ts`, `audio-capture.ts` | Deleted |
| `.env.example` | `NEXT_PUBLIC_OPENAI_API_KEY` | `OPENAI_API_KEY` |
