'use client'

import Link from 'next/link'
import { RECOMMENDED_VOCABULARY } from '@/lib/stt-vocabulary'
import { IconSparkles, IconClipboardCheck } from '../components/icons'

// Página visible del "diccionario de dictado" para AWS Transcribe. Es la versión doctor-facing
// del custom vocabulary (los pasos técnicos viven en infra/transcribe-vocabulary/).
function buildCsv(): string {
  const rows = [['Término', 'Cómo debe aparecer (opcional)', 'Categoría']]
  for (const g of RECOMMENDED_VOCABULARY) {
    for (const t of g.terms) {
      rows.push([t.term, t.displayAs ?? '', g.category])
    }
  }
  // Escapa comillas/comas por celda.
  return rows
    .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(','))
    .join('\n')
}

export default function DiccionarioPage() {
  function downloadCsv() {
    const blob = new Blob(['﻿' + buildCsv()], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'diccionario-dictado-medconsult.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-primary">
          <IconClipboardCheck className="h-3.5 w-3.5" /> Diccionario de dictado
        </span>
        <h1 className="text-3xl font-bold text-primary">Palabras que el dictado debe reconocer</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Cuando el dictado usa <strong>AWS Transcribe</strong>, podemos entregarle un diccionario
          con los términos clínicos y chilenos que más usas (fármacos, abreviaturas, anatomía) para
          que los escuche y escriba bien. Revisa esta lista recomendada y agrégale lo que falte para
          tu especialidad.
        </p>
        <p className="max-w-2xl rounded-lg border border-soft-blue/30 bg-surface/60 px-3 py-2 text-xs font-medium text-soft-blue">
          Importante: este diccionario es solo de términos médicos generales. No incluyas nombres ni
          datos de pacientes reales.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={downloadCsv}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          Descargar plantilla CSV
        </button>
        <Link
          href="/prompts"
          className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-stroke bg-white px-4 text-sm font-semibold text-muted transition-colors hover:border-primary hover:text-primary"
        >
          <IconSparkles className="h-4 w-4" /> Volver al editor
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {RECOMMENDED_VOCABULARY.map((g) => (
          <section key={g.category} className="card space-y-3">
            <div>
              <h2 className="text-base font-semibold text-ink">{g.category}</h2>
              <p className="text-xs text-muted">{g.hint}</p>
            </div>
            <ul className="flex flex-wrap gap-2">
              {g.terms.map((t) => (
                <li
                  key={t.term}
                  className="rounded-full border border-stroke bg-surface/50 px-3 py-1 text-xs text-ink"
                  title={t.displayAs ? `Aparece como: ${t.displayAs}` : undefined}
                >
                  {t.term}
                  {t.displayAs && t.displayAs !== t.term && (
                    <span className="ml-1 font-semibold text-soft-blue">→ {t.displayAs}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="card space-y-2">
        <h2 className="text-base font-semibold text-ink">¿Cómo se usa?</h2>
        <ol className="ml-4 list-decimal space-y-1 text-sm text-ink">
          <li>Descarga la plantilla, revísala y agrega los términos que falten.</li>
          <li>Nos la envías de vuelta.</li>
          <li>
            La cargamos una sola vez en AWS y, desde ahí, el dictado con Transcribe los reconoce
            automáticamente.
          </li>
        </ol>
        <p className="text-xs text-muted">
          El campo equivalente para el motor de OpenAI ya es editable directamente en el editor de
          prompts (sección "Vocabulario del dictado").
        </p>
      </section>
    </div>
  )
}
