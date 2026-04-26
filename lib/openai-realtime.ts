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
    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    })

    // Add SendRecv audio transceiver (matching Flutter)
    this.pc.addTransceiver('audio', { direction: 'sendrecv' })

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

    // Handle remote tracks (required even in text-only mode for WebRTC negotiation)
    this.pc.ontrack = (event) => {
      console.log('🔊 Remote track received:', event.track.kind)
    }

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
      console.log('✅ Data channel open — configuring session...')
      this.isConnected = true
      // Configure session with transcription and VAD settings after connection
      this.sendEvent({
        type: 'session.update',
        session: {
          type: 'realtime',
          output_modalities: ['text'],
          audio: {
            input: {
              transcription: {
                model: 'gpt-4o-mini-transcribe',
                language: 'es',
              },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
              },
            },
          },
        },
      })
      console.log('✅ Session config sent')
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
