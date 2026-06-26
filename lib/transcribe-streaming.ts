// Browser client for Amazon Transcribe streaming (es-US). Mirrors OpenAIRealtimeClient's
// interface (connect/disconnect) so it slots into useVoiceRecording as an alternative STT.
//
// Flow: GET /api/aws-stt-creds (short-lived AWS creds) → capture mic → downsample to
// 16 kHz mono PCM → stream to Transcribe → emit FINAL transcript segments via onTranscript
// (partials are cumulative in Transcribe, so we skip them to match the OpenAI "completed"
// behavior the hook expects). The extraction loop (2s debounce → /api/extract) is unchanged.
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from '@aws-sdk/client-transcribe-streaming'

const TARGET_RATE = 16000

/** Float32 [-1,1] at inRate → little-endian Int16 PCM at 16 kHz (linear decimation). */
function downsampleToPcm16(input: Float32Array, inRate: number): Uint8Array {
  const ratio = inRate / TARGET_RATE
  const outLen = Math.floor(input.length / ratio)
  const view = new DataView(new ArrayBuffer(outLen * 2))
  for (let i = 0; i < outLen; i++) {
    const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)] ?? 0))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(view.buffer)
}

/** A pushable async queue of PCM chunks the Transcribe AudioStream pulls from. */
function createAudioQueue() {
  const buffered: Uint8Array[] = []
  let resolveNext: ((r: IteratorResult<Uint8Array>) => void) | null = null
  let done = false
  return {
    push(chunk: Uint8Array) {
      if (done) return
      if (resolveNext) {
        resolveNext({ value: chunk, done: false })
        resolveNext = null
      } else {
        buffered.push(chunk)
      }
    },
    stop() {
      done = true
      if (resolveNext) {
        resolveNext({ value: undefined as unknown as Uint8Array, done: true })
        resolveNext = null
      }
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
      while (!done || buffered.length) {
        if (buffered.length) {
          yield buffered.shift()!
        } else {
          const r = await new Promise<IteratorResult<Uint8Array>>((res) => {
            resolveNext = res
          })
          if (r.done) return
          yield r.value
        }
      }
    },
  }
}

export class TranscribeStreamClient {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private queue: ReturnType<typeof createAudioQueue> | null = null
  private connected = false

  async connect(
    onTranscript: (text: string) => void,
    onError: (error: string) => void,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _onTranscriptDelta?: (delta: string) => void,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: { sttPrompt?: string } // STT prompt no aplica a Transcribe (usa custom vocabulary)
  ): Promise<MediaStream> {
    if (this.connected) throw new Error('Ya conectado a Transcribe')

    // 1) short-lived AWS creds (server-side; key never in the browser)
    const credsRes = await fetch('/api/aws-stt-creds')
    if (!credsRes.ok) {
      const j = await credsRes.json().catch(() => ({}))
      const msg = j.error ?? `No se pudieron obtener creds AWS (${credsRes.status})`
      onError(msg)
      throw new Error(msg)
    }
    const creds = await credsRes.json()

    // 2) mic → PCM 16 kHz
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    const queue = createAudioQueue()
    processor.onaudioprocess = (e) => {
      queue.push(downsampleToPcm16(e.inputBuffer.getChannelData(0), ctx.sampleRate))
    }
    source.connect(processor)
    processor.connect(ctx.destination)

    this.stream = stream
    this.ctx = ctx
    this.source = source
    this.processor = processor
    this.queue = queue

    // 3) stream to Transcribe es-US
    const client = new TranscribeStreamingClient({
      region: creds.region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    })

    async function* audioStream() {
      for await (const chunk of queue) {
        yield { AudioEvent: { AudioChunk: chunk } }
      }
    }

    let response
    try {
      response = await client.send(
        new StartStreamTranscriptionCommand({
          LanguageCode: 'es-US',
          MediaEncoding: 'pcm',
          MediaSampleRateHertz: TARGET_RATE,
          AudioStream: audioStream(),
          // Custom vocabulary (medical/Chilean terms) when one is configured server-side.
          // Must exist in the same region as the stream (see infra/transcribe-vocabulary/).
          ...(creds.vocabularyName ? { VocabularyName: creds.vocabularyName } : {}),
        })
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo iniciar Transcribe'
      onError(msg)
      throw err
    }

    this.connected = true

    // 4) consume final transcript segments (background)
    ;(async () => {
      try {
        for await (const event of response.TranscriptResultStream!) {
          for (const r of event.TranscriptEvent?.Transcript?.Results ?? []) {
            const text = r.Alternatives?.[0]?.Transcript ?? ''
            if (text && !r.IsPartial) onTranscript(text)
          }
        }
      } catch (err) {
        if (this.connected) onError(err instanceof Error ? err.message : 'Error de Transcribe')
      }
    })()

    return stream
  }

  disconnect(): void {
    this.connected = false
    this.queue?.stop()
    try {
      this.processor?.disconnect()
      this.source?.disconnect()
    } catch {}
    try {
      this.ctx?.close()
    } catch {}
    this.stream?.getTracks().forEach((t) => t.stop())
    this.processor = null
    this.source = null
    this.ctx = null
    this.stream = null
    this.queue = null
  }

  getIsConnected(): boolean {
    return this.connected
  }
}
