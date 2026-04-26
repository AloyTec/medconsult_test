'use client'

import type { RecordingState } from '@/lib/types'

interface Props {
  state: RecordingState
  onStart: () => Promise<void>
  onStop: () => Promise<void>
  onPause: () => void
  onResume: () => void
  onClear: () => void
}

export function ControlButtons({
  state,
  onStart,
  onStop,
  onPause,
  onResume,
  onClear,
}: Props) {
  return (
    <div className="card">
      <div className="flex flex-wrap gap-3">
        {!state.isRecording ? (
          <button
            onClick={onStart}
            disabled={state.isProcessing}
            className={
              state.isProcessing ? 'btn-disabled' : 'btn-primary'
            }
          >
            {state.isProcessing ? 'Initializing...' : '▶ Start Recording'}
          </button>
        ) : (
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
        )}
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
  )
}
