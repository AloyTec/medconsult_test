'use client'

import { useState } from 'react'
import type { RecordingState, SubmitResult } from '@/lib/types'

interface Props {
  state: RecordingState
  onStart: () => Promise<void>
  onStop: () => Promise<void>
  onPause: () => void
  onResume: () => void
  onClear: () => void
  onSubmit: (summarizeWithAI: boolean, skipValidation?: boolean) => Promise<SubmitResult>
}

export function ControlButtons({
  state,
  onStart,
  onStop,
  onPause,
  onResume,
  onClear,
  onSubmit,
}: Props) {
  const [pendingInconsistency, setPendingInconsistency] = useState<{
    observations: string
    summarizeWithAI: boolean
  } | null>(null)

  const handleSubmit = async (summarizeWithAI: boolean) => {
    setPendingInconsistency(null)
    const result = await onSubmit(summarizeWithAI, false)

    if (!result.consistent && !result.success) {
      setPendingInconsistency({
        observations: result.observations ?? 'Se detectaron inconsistencias.',
        summarizeWithAI,
      })
    }
  }

  const handleForceSubmit = async () => {
    if (!pendingInconsistency) return
    setPendingInconsistency(null)
    await onSubmit(pendingInconsistency.summarizeWithAI, true)
  }

  return (
    <div className="space-y-3">
      {/* Recording controls */}
      <div className="card">
        <div className="flex flex-wrap gap-3">
          {!state.isRecording && !state.isFinished ? (
            <button
              onClick={onStart}
              disabled={state.isProcessing}
              className={state.isProcessing ? 'btn-disabled' : 'btn-primary'}
            >
              {state.isProcessing ? 'Initializing...' : '▶ Start Recording'}
            </button>
          ) : state.isRecording ? (
            <>
              <button onClick={onStop} className="btn-danger">
                ⏹ Stop Recording
              </button>
              {!state.isPaused ? (
                <button onClick={onPause} className="btn-secondary">
                  ⏸ Pause
                </button>
              ) : (
                <button onClick={onResume} className="btn-secondary">
                  ▶ Resume
                </button>
              )}
            </>
          ) : null}
          <button
            onClick={onClear}
            disabled={!state.fullTranscript && !state.extractedData}
            className={
              !state.fullTranscript && !state.extractedData
                ? 'btn-disabled'
                : 'btn-secondary'
            }
          >
            🗑 Clear
          </button>
        </div>
      </div>

      {/* Submit actions - shown when recording is finished */}
      {state.isFinished && !state.submitResult?.success && (
        <div className="card">
          <p className="text-sm text-gray-600 mb-3">
            Grabación finalizada. Elige cómo guardar la consulta:
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => handleSubmit(false)}
              disabled={state.isSubmitting}
              className={state.isSubmitting ? 'btn-disabled' : 'btn-secondary'}
            >
              {state.isSubmitting ? 'Enviando...' : 'Continuar sin IA'}
            </button>
            <button
              onClick={() => handleSubmit(true)}
              disabled={state.isSubmitting}
              className={state.isSubmitting ? 'btn-disabled' : 'btn-primary'}
            >
              {state.isSubmitting ? 'Enviando...' : '✨ Resumir con IA'}
            </button>
          </div>
        </div>
      )}

      {/* Inconsistency dialog */}
      {pendingInconsistency && (
        <div className="card border-yellow-300 bg-yellow-50">
          <h4 className="font-semibold text-yellow-900 mb-2">
            ⚠️ Inconsistencias detectadas
          </h4>
          <p className="text-sm text-yellow-800 mb-3">
            {pendingInconsistency.observations}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setPendingInconsistency(null)}
              className="btn-secondary"
            >
              Cancelar
            </button>
            <button
              onClick={handleForceSubmit}
              disabled={state.isSubmitting}
              className={state.isSubmitting ? 'btn-disabled' : 'btn-danger'}
            >
              {state.isSubmitting ? 'Enviando...' : 'Guardar de todos modos'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
