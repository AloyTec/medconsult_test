'use client'

import { useVoiceRecording } from '@/lib/hooks/useVoiceRecording'
import { ControlButtons } from './ControlButtons'
import { TranscriptDisplay } from './TranscriptDisplay'
import { DataExtraction } from './DataExtraction'

export function VoiceRecorder() {
  const { state, start, stop, pause, resume, clear } = useVoiceRecording()

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="space-y-6">
      {/* Header with timer and status */}
      <div className="flex items-center justify-between rounded-lg bg-gradient-to-r from-blue-50 to-blue-100 p-6">
        <div>
          <h2 className="text-lg font-semibold text-blue-900">
            {state.isRecording ? '🎙️ Recording...' : '🎤 Ready to Record'}
          </h2>
          <p className="text-sm text-blue-700">
            {state.error ? (
              <span className="text-red-600">Error: {state.error}</span>
            ) : state.isRecording ? (
              state.isPaused ? (
                'Paused'
              ) : (
                'Listening to your voice'
              )
            ) : (
              'Click start to begin recording'
            )}
          </p>
        </div>
        <div className="text-right">
          <div className="text-4xl font-bold text-blue-700 font-mono">
            {formatTime(state.elapsedSeconds)}
          </div>
          <div className="text-xs text-blue-600 mt-1">
            {state.isProcessing && 'Initializing...'}
          </div>
        </div>
      </div>

      {/* Status indicators */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center">
          <div className="text-2xl font-bold text-blue-700">
            {state.fullTranscript.split(' ').length}
          </div>
          <div className="text-xs text-gray-600 mt-1">Words</div>
        </div>
        <div className="card text-center">
          <div
            className={`text-2xl font-bold ${
              state.extractedData ? 'text-green-600' : 'text-gray-400'
            }`}
          >
            {state.extractedData ? '✓' : '−'}
          </div>
          <div className="text-xs text-gray-600 mt-1">Data Extracted</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-blue-700">
            {state.extractedData
              ? 100
              : 0}
            %
          </div>
          <div className="text-xs text-gray-600 mt-1">Confidence</div>
        </div>
      </div>

      {/* Control buttons */}
      <ControlButtons
        state={state}
        onStart={start}
        onStop={stop}
        onPause={pause}
        onResume={resume}
        onClear={clear}
      />

      {/* Error display */}
      {state.error && (
        <div className="rounded-lg bg-red-50 p-4 border border-red-200">
          <p className="text-sm text-red-800">
            <strong>Error:</strong> {state.error}
          </p>
        </div>
      )}

      {/* Transcript display */}
      <TranscriptDisplay
        liveTranscript={state.liveTranscript}
        fullTranscript={state.fullTranscript}
      />

      {/* Data extraction display */}
      <DataExtraction extractedData={state.extractedData} isExtracting={state.isExtracting} />
    </div>
  )
}
