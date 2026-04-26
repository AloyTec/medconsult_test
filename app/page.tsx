'use client'

import { VoiceRecorder } from './components/VoiceRecorder'

export default function Home() {
  return (
    <div className="space-y-6">
      {/* Introduction */}
      <section className="rounded-lg bg-gradient-to-r from-blue-50 to-blue-50 p-6 border border-blue-200">
        <h2 className="text-2xl font-bold text-blue-900 mb-3">
          Welcome to MedConsult Voice Testing
        </h2>
        <p className="text-blue-700 mb-4">
          This application allows you to test real-time medical voice transcription with
          AI-powered clinical data extraction. The system uses OpenAI's Realtime API to
          transcribe your voice and automatically extract structured clinical information.
        </p>
        <div className="space-y-2 text-sm text-blue-700">
          <p>
            <strong>✓ Real-time transcription:</strong> See text appear as you speak
          </p>
          <p>
            <strong>✓ Automatic data extraction:</strong> Clinical data is extracted to JSON
          </p>
          <p>
            <strong>✓ Confidence scoring:</strong> See how confident the AI is about the data
          </p>
          <p>
            <strong>✓ Patient privacy:</strong> Data is processed locally and not stored
          </p>
        </div>
      </section>

      {/* Setup instructions */}
      <section className="rounded-lg bg-yellow-50 p-4 border border-yellow-200">
        <h3 className="font-semibold text-yellow-900 mb-2">⚙️ Setup Required</h3>
        <ol className="text-sm text-yellow-900 space-y-1 ml-4 list-decimal">
          <li>Copy your OpenAI API key</li>
          <li>
            Create <code className="bg-yellow-100 px-1 rounded">.env.local</code> file
          </li>
          <li>
            Add: <code className="bg-yellow-100 px-1 rounded">NEXT_PUBLIC_OPENAI_API_KEY=your_key</code>
          </li>
          <li>Reload the page</li>
        </ol>
      </section>

      {/* Main voice recorder */}
      <section>
        <VoiceRecorder />
      </section>

      {/* Footer info */}
      <section className="rounded-lg bg-gray-50 p-4 border border-gray-200 text-center text-sm text-gray-600">
        <p>
          Questions? Check the documentation for more information about using this app.
        </p>
      </section>
    </div>
  )
}
