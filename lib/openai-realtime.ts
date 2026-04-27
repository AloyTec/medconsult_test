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
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private sessionId: string = "";
  private onTranscript: ((text: string) => void) | null = null;
  private onTranscriptDelta: ((delta: string) => void) | null = null;
  private onError: ((error: string) => void) | null = null;
  private isConnected: boolean = false;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private audioLevelInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Connect to OpenAI Realtime API via WebRTC
   */
  async connect(
    onTranscript: (text: string) => void,
    onError: (error: string) => void,
    onTranscriptDelta?: (delta: string) => void,
  ): Promise<MediaStream> {
    if (this.isConnected) {
      throw new Error("Already connected to OpenAI Realtime API");
    }

    this.onTranscript = onTranscript;
    this.onError = onError;
    this.onTranscriptDelta = onTranscriptDelta ?? null;

    // Step 1: Get ephemeral token from our server-side API route
    console.log("🔑 Step 1/3: Getting ephemeral token from server...");
    let token: string;
    try {
      const tokenRes = await fetch("/api/realtime-token", { method: "POST" });
      if (!tokenRes.ok) {
        const err = await tokenRes.json();
        throw new Error(
          err.error || `Token request failed: ${tokenRes.status}`,
        );
      }
      const tokenData = await tokenRes.json();
      token = tokenData.token;
      console.log(
        "✅ Ephemeral token acquired, expires:",
        tokenData.expires_at,
      );
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to get token";
      console.error("❌ Token error:", msg);
      this.onError?.(msg);
      throw error;
    }

    // Step 2: Create WebRTC peer connection (matching OpenAI's official WebRTC example)
    console.log("🔗 Step 2/3: Creating WebRTC peer connection...");
    this.pc = new RTCPeerConnection();

    // Get microphone audio and add to peer connection
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    const audioTrack = mediaStream.getTracks()[0];
    this.pc.addTrack(audioTrack);
    console.log(
      "🎤 Added local audio track:",
      audioTrack.kind,
      "| enabled:",
      audioTrack.enabled,
      "| muted:",
      audioTrack.muted,
      "| readyState:",
      audioTrack.readyState,
      "| label:",
      audioTrack.label,
    );
    console.log("🔍 [DEBUG] PC senders:", this.pc.getSenders().length);
    console.log(
      "🔍 [DEBUG] PC transceivers:",
      this.pc.getTransceivers().length,
    );
    this.pc.getTransceivers().forEach((t, i) => {
      console.log(`🔍 [DEBUG] Transceiver[${i}]:`, {
        mid: t.mid,
        direction: t.direction,
        currentDirection: t.currentDirection,
        senderTrack: t.sender.track?.kind ?? "null",
        senderTrackEnabled: t.sender.track?.enabled ?? "N/A",
      });
    });

    // Handle remote tracks (required even in text-only mode for WebRTC negotiation)
    this.pc.ontrack = (event) => {
      console.log("🔊 Remote track received:", event.track.kind);
    };

    // Monitor ICE connection state
    this.pc.oniceconnectionstatechange = () => {
      console.log("🧊 ICE state:", this.pc?.iceConnectionState);
    };
    this.pc.onconnectionstatechange = () => {
      console.log("🔗 Connection state:", this.pc?.connectionState);
    };

    // Create data channel for events
    this.dc = this.pc.createDataChannel("oai-events");
    this.setupDataChannel(this.dc);

    // Also listen for server-created data channels
    this.pc.ondatachannel = (event) => {
      console.log("📡 Received server data channel:", event.channel.label);
      this.dc = event.channel;
      this.setupDataChannel(this.dc);
    };

    // Step 3: SDP exchange with OpenAI
    console.log("📡 Step 3/3: SDP offer/answer exchange...");
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    console.log(
      "🔍 [DEBUG] SDP offer created, type:",
      offer.type,
      "sdp length:",
      offer.sdp?.length,
    );

    const sdpUrl =
      "https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview";
    console.log("🔍 [DEBUG] Sending SDP to:", sdpUrl);
    const sdpResponse = await fetch(sdpUrl, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/sdp",
      },
    });

    console.log(
      "🔍 [DEBUG] SDP response status:",
      sdpResponse.status,
      sdpResponse.statusText,
    );
    console.log(
      "🔍 [DEBUG] SDP response headers:",
      Object.fromEntries(sdpResponse.headers.entries()),
    );

    if (!sdpResponse.ok) {
      const errText = await sdpResponse.text();
      const msg = `SDP exchange failed: ${sdpResponse.status} ${errText}`;
      console.error("❌", msg);
      this.onError?.(msg);
      throw new Error(msg);
    }

    const answerSdp = await sdpResponse.text();
    console.log("✅ SDP answer received, length:", answerSdp.length);

    await this.pc.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });

    console.log("✅ WebRTC connection established!");
    console.log("🔍 [DEBUG] PC signalingState:", this.pc.signalingState);
    console.log(
      "🔍 [DEBUG] PC iceConnectionState:",
      this.pc.iceConnectionState,
    );
    console.log("🔍 [DEBUG] PC connectionState:", this.pc.connectionState);
    console.log("🔍 [DEBUG] Data channel readyState:", this.dc?.readyState);

    // DEBUG: Monitor WebRTC stats every 2 seconds to check if audio bytes are flowing
    this.statsInterval = setInterval(async () => {
      if (!this.pc) return;
      try {
        const stats = await this.pc.getStats();
        stats.forEach((report) => {
          if (report.type === "outbound-rtp" && report.kind === "audio") {
            console.log(
              "📊 [DEBUG] Audio RTP stats — bytesSent:",
              report.bytesSent,
              "| packetsSent:",
              report.packetsSent,
              "| timestamp:",
              report.timestamp,
            );
          }
          if (
            report.type === "candidate-pair" &&
            report.state === "succeeded"
          ) {
            console.log(
              "📊 [DEBUG] ICE candidate pair — bytesSent:",
              report.bytesSent,
              "| bytesReceived:",
              report.bytesReceived,
              "| currentRoundTripTime:",
              report.currentRoundTripTime,
            );
          }
        });
      } catch {
        // PC might be closed
      }
    }, 2000);

    // DEBUG: Monitor actual microphone audio levels
    try {
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(mediaStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      this.audioLevelInterval = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        const avg =
          dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
        const max = Math.max(...dataArray);
        console.log(
          "🔊 [DEBUG] Mic audio level — avg:",
          avg.toFixed(1),
          "| max:",
          max,
          "| (should be >0 when speaking)",
        );
      }, 2000);
    } catch (err) {
      console.warn("⚠️ [DEBUG] Could not create audio level monitor:", err);
    }

    return mediaStream;
  }

  /**
   * Send an event via data channel
   */
  sendEvent(event: Record<string, unknown>): void {
    if (!this.dc || this.dc.readyState !== "open") {
      console.warn("⚠️ Data channel not ready");
      return;
    }
    this.dc.send(JSON.stringify(event));
  }

  /**
   * Set up data channel event handlers
   */
  private setupDataChannel(dc: RTCDataChannel): void {
    dc.onopen = () => {
      console.log("✅ Data channel open — configuring session...");
      console.log(
        "🔍 [DEBUG] Data channel label:",
        dc.label,
        "id:",
        dc.id,
        "readyState:",
        dc.readyState,
      );
      this.isConnected = true;
      // Configure session with transcription and VAD settings after connection
      const sessionConfig = {
        type: "session.update",
        session: {
          modalities: ["text"],
          input_audio_transcription: {
            model: "gpt-4o-mini-transcribe",
            language: "es",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.3,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            create_response: false,
          },
        },
      };
      console.log(
        "🔍 [DEBUG] Sending session config:",
        JSON.stringify(sessionConfig, null, 2),
      );
      this.sendEvent(sessionConfig);
      console.log("✅ Session config sent");
    };
    dc.onmessage = (event) => {
      this.handleMessage(event.data);
    };
    dc.onclose = () => {
      console.log("📴 Data channel closed");
      this.isConnected = false;
    };
    dc.onerror = (event) => {
      console.error("❌ Data channel error:", event);
    };
  }

  /**
   * Handle incoming events from OpenAI via data channel.
   * Only processes transcription-related events.
   */
  private handleMessage(data: string): void {
    try {
      const event = JSON.parse(data);

      // DEBUG: Log ALL incoming events so we can see exactly what OpenAI sends
      console.log(
        "🔍 [DEBUG] <<< Incoming event type:",
        event.type,
        "| keys:",
        Object.keys(event).join(", "),
      );

      switch (event.type) {
        case "session.created":
          this.sessionId = event.session?.id || "";
          console.log("✅ Session created:", this.sessionId);
          console.log(
            "🔍 [DEBUG] Session details:",
            JSON.stringify(event.session, null, 2),
          );
          break;

        case "session.updated":
          console.log("✅ Session updated");
          console.log(
            "🔍 [DEBUG] Updated session config:",
            JSON.stringify(event.session, null, 2),
          );
          break;

        case "input_audio_buffer.speech_started":
          console.log("🎤 Speech detected");
          console.log(
            "🔍 [DEBUG] Speech started event:",
            JSON.stringify(event),
          );
          break;

        case "input_audio_buffer.speech_stopped":
          console.log("🤐 Speech stopped");
          console.log(
            "🔍 [DEBUG] Speech stopped event:",
            JSON.stringify(event),
          );
          break;

        case "conversation.item.input_audio_transcription.delta":
          if (event.delta) {
            this.onTranscriptDelta?.(event.delta);
          }
          break;

        case "conversation.item.input_audio_transcription.completed":
          console.log(
            "📝 Transcript completed:",
            event.transcript?.substring(0, 80),
          );
          if (event.transcript) {
            this.onTranscript?.(event.transcript);
          }
          break;

        case "conversation.item.input_audio_transcription.failed":
          console.error(
            "❌ Transcription failed:",
            JSON.stringify(event.error),
          );
          console.error(
            "🔍 [DEBUG] Full transcription failure event:",
            JSON.stringify(event),
          );
          break;

        case "error":
          if (event.error) {
            const errorMsg = `${event.error.code || event.error.type}: ${event.error.message}`;
            console.error("❌ OpenAI error:", errorMsg);
            console.error(
              "🔍 [DEBUG] Full error event:",
              JSON.stringify(event),
            );
            this.onError?.(errorMsg);
          }
          break;

        default:
          // DEBUG: Log unknown events instead of silently ignoring them
          console.log(
            "🔍 [DEBUG] Unhandled event type:",
            event.type,
            "| Full event:",
            JSON.stringify(event).substring(0, 500),
          );
          break;
      }
    } catch (error) {
      console.error("❌ Error parsing message:", error);
    }
  }

  /**
   * Disconnect and clean up
   */
  disconnect(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    if (this.audioLevelInterval) {
      clearInterval(this.audioLevelInterval);
      this.audioLevelInterval = null;
    }
    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.isConnected = false;
    console.log("🔌 Disconnected");
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }

  getSessionId(): string {
    return this.sessionId;
  }
}
