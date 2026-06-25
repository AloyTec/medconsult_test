'use client'

import Link from 'next/link'
import { VoiceRecorder } from './components/VoiceRecorder'
import { IconSparkles } from './components/icons'

export default function Home() {
  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="overflow-hidden rounded-2xl border border-stroke bg-gradient-to-br from-surface-strong via-surface to-white p-8">
        <h1 className="text-3xl font-bold text-primary">Estudio de prompts clínicos</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Transcribe el dictado médico y extrae la consulta en datos estructurados — y afina los
          prompts de la IA hasta dejarlos perfectos, sin tocar la app de los doctores.
        </p>
        <div className="mt-6">
          <Link
            href="/prompts"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            <IconSparkles className="h-4 w-4" /> Abrir editor de prompts
          </Link>
        </div>
      </section>

      {/* Configuración (server-side, la forma correcta) */}
      <section className="rounded-2xl border border-stroke bg-surface p-5">
        <h2 className="mb-2 text-base font-semibold text-primary">Configuración</h2>
        <ol className="ml-4 list-decimal space-y-1 text-sm text-ink">
          <li>
            En <code className="rounded bg-white px-1 text-xs">.env.local</code> define{' '}
            <code className="rounded bg-white px-1 text-xs">OPENAI_API_KEY=tu_clave</code>{' '}
            <strong>(server-side — sin el prefijo <code>NEXT_PUBLIC_</code>)</strong>.
          </li>
          <li>
            Ejecuta <code className="rounded bg-white px-1 text-xs">npm run dev</code>.
          </li>
          <li>Abre el editor de prompts o el demo de voz.</li>
        </ol>
        <p className="mt-2 text-xs text-muted">
          La clave vive solo en el servidor; el navegador nunca la recibe.
        </p>
      </section>

      {/* Demo de voz (carril en evolución → real-time fiel a Flutter) */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-ink">Demo de voz</h2>
          <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-soft-blue">
            en evolución
          </span>
        </div>
        <VoiceRecorder />
      </section>
    </div>
  )
}
