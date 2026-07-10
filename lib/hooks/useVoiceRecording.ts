'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { OpenAIRealtimeClient } from '../openai-realtime'
import { TranscribeStreamClient } from '../transcribe-streaming'
import { ClinicalExtractionService } from '../clinical-extraction'
import { validateConsistency, summarizeSections } from '../api'
import type { RecordingState, SubmitResult } from '../types'

export function useVoiceRecording(options?: {
  getPrompt?: () => string | undefined
  getEngine?: () => string | undefined
  getModel?: () => string | undefined
  getStt?: () => 'openai' | 'transcribe'
  getSttPrompt?: () => string | undefined
  getAtencionId?: () => string | undefined
  onNewDictation?: () => void
}) {
  // Keep the latest getters in refs so changes during recording are picked up.
  const getPromptRef = useRef(options?.getPrompt)
  getPromptRef.current = options?.getPrompt
  const getEngineRef = useRef(options?.getEngine)
  getEngineRef.current = options?.getEngine
  const getModelRef = useRef(options?.getModel)
  getModelRef.current = options?.getModel
  const getSttRef = useRef(options?.getStt)
  getSttRef.current = options?.getStt
  const getSttPromptRef = useRef(options?.getSttPrompt)
  getSttPromptRef.current = options?.getSttPrompt
  const getAtencionIdRef = useRef(options?.getAtencionId)
  getAtencionIdRef.current = options?.getAtencionId
  const onNewDictationRef = useRef(options?.onNewDictation)
  onNewDictationRef.current = options?.onNewDictation
  // Copia del transcript acumulado para sembrar el extractor al re-grabar.
  const fullTranscriptRef = useRef('')

  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    isFinished: false,
    liveTranscript: '',
    fullTranscript: '',
    extractedData: null,
    error: null,
    isProcessing: false,
    isExtracting: false,
    isSubmitting: false,
    submitResult: null,
    elapsedSeconds: 0,
    saveWarn: false,
  })

  const openaiRef = useRef<OpenAIRealtimeClient | TranscribeStreamClient | null>(null)
  const extractionRef = useRef<ClinicalExtractionService | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const start = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, error: null, isProcessing: true }))

      // Dictar con el área vacía = atención nueva (spec trigger a); con texto,
      // continúa la misma atención sembrando el buffer con lo ya dictado.
      if (fullTranscriptRef.current.trim() === '') {
        onNewDictationRef.current?.()
      }

      extractionRef.current = new ClinicalExtractionService(
        (data) => {
          setState((prev) => ({ ...prev, extractedData: data }))
        },
        (isExtracting) => {
          setState((prev) => ({ ...prev, isExtracting }))
        },
        () => getPromptRef.current?.(),
        () => getEngineRef.current?.(),
        () => getModelRef.current?.(),
        () => getAtencionIdRef.current?.(),
        () => (getSttRef.current?.() === 'transcribe' ? 'transcribe' : 'openai-realtime'),
        (saved) => setState((prev) => ({ ...prev, saveWarn: !saved }))
      )
      extractionRef.current.seed(fullTranscriptRef.current)

      const sttEngine = getSttRef.current?.() ?? 'openai'
      openaiRef.current =
        sttEngine === 'transcribe' ? new TranscribeStreamClient() : new OpenAIRealtimeClient()

      console.log(`🔍 [DEBUG] useVoiceRecording: Connecting via ${sttEngine}...`)
      const mediaStream = await openaiRef.current.connect(
        // onTranscript — fires when a complete turn is transcribed
        (text) => {
          setState((prev) => {
            const fullTranscript = (prev.fullTranscript + ' ' + text).trim()
            fullTranscriptRef.current = fullTranscript
            return { ...prev, liveTranscript: '', fullTranscript }
          })
          extractionRef.current?.addTranscript(text)
        },
        // onError
        (error) => {
          console.error('🔍 [DEBUG] useVoiceRecording: onError callback fired:', error)
          setState((prev) => ({
            ...prev,
            error,
            isRecording: false,
          }))
        },
        // onTranscriptDelta — fires word-by-word for streaming display
        (delta) => {
          setState((prev) => ({
            ...prev,
            liveTranscript: prev.liveTranscript + delta,
          }))
        },
        // STT vocabulary bias (OpenAI only; Transcribe ignores it and uses a custom vocabulary)
        { sttPrompt: getSttPromptRef.current?.() }
      )
      console.log('🔍 [DEBUG] useVoiceRecording: Connected, got mediaStream with', mediaStream.getTracks().length, 'tracks')

      mediaStreamRef.current = mediaStream

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

  const stop = useCallback(async () => {
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

    // Extrae lo pendiente del debounce para que la última corrida refleje el
    // dictado completo, y recién entonces suelta los callbacks.
    await extractionRef.current?.flush()
    extractionRef.current?.destroy()
    extractionRef.current = null

    setState((prev) => ({
      ...prev,
      isRecording: false,
      isPaused: false,
      isFinished: true,
    }))
  }, [])

  const submit = useCallback(async (summarizeWithAI: boolean, skipValidation = false) => {
    setState((prev) => ({ ...prev, isSubmitting: true, submitResult: null, error: null }))

    try {
      const data = state.extractedData
      if (!data) throw new Error('No hay datos extraídos para procesar')

      // Step 1: Validate consistency (unless skipped)
      if (!skipValidation) {
        const validation = await validateConsistency(data)
        if (!validation.consistent) {
          const result: SubmitResult = {
            success: false,
            consistent: false,
            observations: validation.observations,
            message: 'La consulta presenta inconsistencias',
          }
          setState((prev) => ({ ...prev, submitResult: result }))
          return result
        }
      }

      // Step 2: Summarize if requested
      let summarizedSections: SubmitResult['summarizedSections'] = undefined
      if (summarizeWithAI) {
        const summarized = await summarizeSections(data)
        summarizedSections = {
          antecedentes: summarized.antecedentes,
          anamnesis: summarized.motivoConsulta,
          examenFisico: summarized.examenFisico,
          diagnostico: summarized.diagnostico,
          plan: summarized.planTrabajo,
        }
      }

      const result: SubmitResult = {
        success: true,
        consistent: true,
        observations: skipValidation ? 'Validación omitida' : 'Consulta coherente',
        summarized: summarizeWithAI,
        summarizedSections,
        message: summarizeWithAI
          ? 'Consulta validada y resumida con IA'
          : 'Consulta validada correctamente',
      }

      setState((prev) => ({ ...prev, submitResult: result }))
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al procesar consulta'
      setState((prev) => ({ ...prev, error: message }))
      return { success: false, consistent: false, message } as SubmitResult
    } finally {
      setState((prev) => ({ ...prev, isSubmitting: false }))
    }
  }, [state.extractedData])

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

  const resume = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = true
      })
    }
    timerRef.current = setInterval(() => {
      setState((prev) => ({ ...prev, elapsedSeconds: prev.elapsedSeconds + 1 }))
    }, 1000)
    setState((prev) => ({ ...prev, isPaused: false }))
  }, [])

  const clear = useCallback(() => {
    fullTranscriptRef.current = ''
    setState((prev) => ({
      ...prev,
      liveTranscript: '',
      fullTranscript: '',
      extractedData: null,
      isFinished: false,
      submitResult: null,
      elapsedSeconds: 0,
      saveWarn: false,
    }))
  }, [])

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
    submit,
  }
}
