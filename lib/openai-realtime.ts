// lib/openai-realtime.ts

/**
 * OpenAI Realtime client (WebRTC) — transcription only.
 *
 * The SDP exchange is proxied through /api/realtime/sdp so the OpenAI key stays
 * server-side; the browser never sees it. Audio + transcript events flow P2P
 * (browser ↔ OpenAI). The session config (model gpt-realtime-2, Spanish
 * transcription) is set server-side, mirroring the Flutter app.
 *
 * Clinical extraction is handled separately (ClinicalExtractionService): each
 * completed transcript segment is buffered and debounced into /api/extract.
 */
export class OpenAIRealtimeClient {
  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private stream: MediaStream | null = null
  private connected = false
  private onTranscript: ((text: string) => void) | null = null
  private onError: ((error: string) => void) | null = null
  private onTranscriptDelta: ((delta: string) => void) | null = null

  async connect(
    onTranscript: (text: string) => void,
    onError: (error: string) => void,
    onTranscriptDelta?: (delta: string) => void
  ): Promise<MediaStream> {
    if (this.connected) throw new Error('Ya conectado a Realtime')
    this.onTranscript = onTranscript
    this.onError = onError
    this.onTranscriptDelta = onTranscriptDelta ?? null

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    this.pc = pc

    // Microphone → peer connection.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    this.stream = stream
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream))

    // Data channel carries the transcript events (server → client).
    const dc = pc.createDataChannel('oai-events', { ordered: true })
    this.dc = dc
    dc.onmessage = (e) => this.handleEvent(e.data)
    pc.ondatachannel = (e) => {
      this.dc = e.channel
      e.channel.onmessage = (ev) => this.handleEvent(ev.data)
    }

    // SDP offer → our server proxy → answer.
    const offer = await pc.createOffer({ offerToReceiveAudio: true })
    await pc.setLocalDescription(offer)

    let answerSdp: string
    try {
      const res = await fetch('/api/realtime/sdp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: offer.sdp }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `SDP exchange falló (${res.status})`)
      }
      answerSdp = await res.text()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo conectar a Realtime'
      this.onError?.(msg)
      throw err
    }

    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    this.connected = true
    return stream
  }

  private handleEvent(data: string): void {
    try {
      const event = JSON.parse(data)
      switch (event?.type) {
        case 'conversation.item.input_audio_transcription.delta':
          if (event.delta) this.onTranscriptDelta?.(event.delta)
          break
        case 'conversation.item.input_audio_transcription.completed':
          if (event.transcript) this.onTranscript?.(event.transcript)
          break
        case 'error':
          if (event.error) {
            this.onError?.(
              `${event.error.code ?? event.error.type ?? 'error'}: ${event.error.message ?? ''}`
            )
          }
          break
      }
    } catch {
      // ignore non-JSON frames
    }
  }

  disconnect(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    try {
      this.dc?.close()
    } catch {}
    try {
      this.pc?.close()
    } catch {}
    this.dc = null
    this.pc = null
    this.stream = null
    this.connected = false
  }

  getIsConnected(): boolean {
    return this.connected
  }
}
