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
  private getPrompt: (() => string | undefined) | null = null

  constructor(
    onExtracted: (data: ExtractedData) => void,
    onExtracting: (isExtracting: boolean) => void,
    getPrompt?: () => string | undefined
  ) {
    this.onExtracted = onExtracted
    this.onExtracting = onExtracting
    this.getPrompt = getPrompt ?? null
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

    // The live prompt (if the caller provides one) so on-the-fly prompt edits
    // take effect on the next extraction. Blank/absent → server uses the default.
    const prompt = this.getPrompt?.()
    const payload =
      prompt && prompt.trim().length > 0
        ? { transcript: this.buffer, prompt }
        : { transcript: this.buffer }

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
