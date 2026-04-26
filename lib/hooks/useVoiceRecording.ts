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

  const start = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, error: null, isProcessing: true }))

      extractionRef.current = new ClinicalExtractionService(
        (data) => {
          setState((prev) => ({ ...prev, extractedData: data }))
        },
        (isExtracting) => {
          setState((prev) => ({ ...prev, isExtracting }))
        }
      )

      openaiRef.current = new OpenAIRealtimeClient()

      const mediaStream = await openaiRef.current.connect(
        (text) => {
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

    extractionRef.current?.destroy()
    extractionRef.current = null

    setState((prev) => ({
      ...prev,
      isRecording: false,
      isPaused: false,
    }))
  }, [])

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
    setState((prev) => ({
      ...prev,
      liveTranscript: '',
      fullTranscript: '',
      extractedData: null,
      elapsedSeconds: 0,
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
  }
}
