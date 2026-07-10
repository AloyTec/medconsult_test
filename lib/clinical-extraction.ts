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
  private inflight: Promise<void> | null = null
  private onExtracted: ((data: ExtractedData) => void) | null = null
  private onExtracting: ((isExtracting: boolean) => void) | null = null
  private getPrompt: (() => string | undefined) | null = null
  private getEngine: (() => string | undefined) | null = null
  private getModel: (() => string | undefined) | null = null
  private getAtencionId: (() => string | undefined) | null = null
  private getSttEngine: (() => string | undefined) | null = null
  private onSaveStatus: ((saved: boolean) => void) | null = null

  constructor(
    onExtracted: (data: ExtractedData) => void,
    onExtracting: (isExtracting: boolean) => void,
    getPrompt?: () => string | undefined,
    getEngine?: () => string | undefined,
    getModel?: () => string | undefined,
    getAtencionId?: () => string | undefined,
    getSttEngine?: () => string | undefined,
    onSaveStatus?: (saved: boolean) => void
  ) {
    this.onExtracted = onExtracted
    this.onExtracting = onExtracting
    this.getPrompt = getPrompt ?? null
    this.getEngine = getEngine ?? null
    this.getModel = getModel ?? null
    this.getAtencionId = getAtencionId ?? null
    this.getSttEngine = getSttEngine ?? null
    this.onSaveStatus = onSaveStatus ?? null
  }

  /**
   * Siembra el buffer con el transcript ya acumulado en la página: dictar de nuevo
   * CONTINÚA la misma atención y el transcript persistido no pierde lo anterior.
   */
  seed(text: string): void {
    this.buffer = text.trim()
  }

  /**
   * Al detener la grabación: si hay una extracción pendiente del debounce la
   * dispara YA; si ya hay una en vuelo la espera (sin duplicar la llamada).
   */
  flush(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
      return this.extract()
    }
    return this.inflight ?? Promise.resolve()
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
      this.debounceTimer = null
      this.extract()
    }, 2000)
  }

  /** Corre la extracción registrando el vuelo, para que flush() pueda esperarla. */
  extract(): Promise<void> {
    const run = this.performExtract()
    this.inflight = run
    run.finally(() => {
      if (this.inflight === run) this.inflight = null
    })
    return run
  }

  /**
   * Call the extraction API with the accumulated buffer.
   */
  private async performExtract(): Promise<void> {
    if (!this.buffer.trim()) return

    const currentJobId = ++this.jobId
    this.onExtracting?.(true)

    // Live prompt / engine / model so on-the-fly changes take effect on the next
    // extraction. Blank/absent → server uses its defaults.
    const prompt = this.getPrompt?.()
    const engine = this.getEngine?.()
    const model = this.getModel?.()
    const payload: Record<string, unknown> = { transcript: this.buffer }
    if (prompt && prompt.trim().length > 0) payload.prompt = prompt
    if (engine) payload.engine = engine
    if (model) payload.model = model
    const atencionId = this.getAtencionId?.()
    if (atencionId) payload.atencionId = atencionId
    const stt = this.getSttEngine?.()
    if (stt) payload.stt = stt

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      // Stale check: a newer extraction has been triggered
      if (currentJobId !== this.jobId) return

      if (!response.ok) {
        console.error('Extraction failed:', response.status)
        return
      }

      const savedHeader = response.headers.get('x-atencion-saved')
      if (savedHeader !== null) this.onSaveStatus?.(savedHeader === 'true')

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
    this.onSaveStatus = null
  }
}
