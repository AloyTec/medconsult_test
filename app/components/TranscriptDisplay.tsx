'use client'

interface Props {
  liveTranscript: string
  fullTranscript: string
}

export function TranscriptDisplay({ liveTranscript, fullTranscript }: Props) {
  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Transcript</h3>

      {fullTranscript ? (
        <div className="space-y-4">
          {/* Live/Current text */}
          {liveTranscript && (
            <div className="rounded-lg bg-blue-50 p-4 border border-blue-200">
              <p className="text-xs font-semibold text-blue-700 mb-2">
                LIVE INPUT
              </p>
              <p className="text-gray-900 italic">{liveTranscript}</p>
            </div>
          )}

          {/* Full transcript */}
          <div className="rounded-lg bg-gray-50 p-4 border border-gray-200">
            <p className="text-xs font-semibold text-gray-700 mb-2">
              FULL TRANSCRIPT
            </p>
            <p className="text-gray-900 leading-relaxed text-sm">
              {fullTranscript}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              {fullTranscript.split(' ').length} words
            </p>
          </div>
        </div>
      ) : (
        <p className="text-center text-gray-500 py-8">
          Start recording to see transcript appear here
        </p>
      )}
    </div>
  )
}
