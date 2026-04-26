import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MedConsult Voice Testing',
  description:
    'Real-time medical voice transcription with AI-powered data extraction',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-6xl">
          <header className="border-b border-gray-200 bg-white shadow-sm">
            <div className="px-6 py-4">
              <h1 className="text-2xl font-bold text-blue-700">
                🎤 MedConsult Voice Testing
              </h1>
              <p className="mt-1 text-sm text-gray-600">
                Real-time medical voice transcription with AI data extraction
              </p>
            </div>
          </header>
          <main className="px-6 py-8">{children}</main>
          <footer className="border-t border-gray-200 bg-white py-4 text-center text-sm text-gray-600">
            <p>MedConsult v1.0 | Built with Next.js 16 & OpenAI Realtime API</p>
          </footer>
        </div>
      </body>
    </html>
  )
}
