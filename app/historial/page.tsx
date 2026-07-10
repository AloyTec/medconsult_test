'use client'

import { useEffect, useState } from 'react'
import { DataExtraction } from '../components/DataExtraction'
import { IconClipboardCheck, IconTranscript, Spinner } from '../components/icons'
import type { Atencion, AtencionListItem } from '@/lib/atenciones'

/**
 * Historial de atenciones (solo lectura). Lista newest-first; click → detalle con
 * transcript, corridas (STT + IA + prompt + resultado), última validación y último
 * resumen (cada uno con su prompt e IA). Los datos vienen ANONIMIZADOS desde el
 * guardado — acá no hay pacientes identificables.
 */

const STT_LABEL: Record<string, string> = {
  'openai-realtime': 'Dictado OpenAI',
  transcribe: 'Dictado AWS Transcribe',
  texto: 'Texto pegado',
}

function fmtFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-CL', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/** Chip "IA + modelo + prompt colapsable" reutilizado por validación y resumen. */
function MetaYPrompt({ engine, model, prompt }: { engine: string; model: string; prompt: string }) {
  return (
    <div className="space-y-2">
      <span className="inline-flex rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-soft-blue">
        {engine} · {model}
      </span>
      <details className="rounded-md bg-surface/40 p-2">
        <summary className="cursor-pointer text-xs font-semibold text-muted">
          Prompt utilizado
        </summary>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink">
          {prompt}
        </pre>
      </details>
    </div>
  )
}

export default function HistorialPage() {
  const [items, setItems] = useState<AtencionListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Atencion | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    fetch('/api/atenciones')
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error)
        return r.json()
      })
      .then((d) => setItems(Array.isArray(d?.atenciones) ? d.atenciones : []))
      .catch((e) => setError(e instanceof Error && e.message ? e.message : 'No se pudo cargar el historial.'))
      .finally(() => setLoading(false))
  }, [])

  async function openDetail(id: string) {
    setDetailLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/atenciones/${id}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error ?? `No se pudo cargar la atención (${res.status}).`)
        return
      }
      setSelected((await res.json()) as Atencion)
    } catch {
      setError('No se pudo conectar con el servidor. Intenta de nuevo.')
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-primary">
          <IconClipboardCheck className="h-3.5 w-3.5" /> Historial de atenciones
        </span>
        <h1 className="text-3xl font-bold text-primary">Revisa las respuestas previas</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Cada atención guarda el dictado enviado, el sistema de dictado usado, la IA y el
          prompt de cada paso, y sus resultados (extracción, validación y resumen). Los datos
          del paciente se guardan anonimizados; identifica cada atención por su fecha y hora.
        </p>
      </header>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="h-4 w-4" /> Cargando historial…
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-surface px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="card text-sm text-muted">
          Todavía no hay atenciones guardadas. Corre una extracción en el editor de prompts y
          aparecerá aquí automáticamente.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Lista */}
        <div className="space-y-2">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => openDetail(it.id)}
              className={`flex w-full flex-col gap-1 rounded-lg border bg-white px-4 py-3 text-left transition-colors hover:border-primary ${
                selected?.sk === it.id ? 'border-primary' : 'border-stroke'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">{it.pseudonym}</span>
                <span className="text-[11px] text-muted">{fmtFecha(it.createdAt)}</span>
              </span>
              {it.lastDiagnostico && (
                <span className="truncate text-xs text-muted">Dx: {it.lastDiagnostico}</span>
              )}
              <span className="flex flex-wrap items-center gap-2 pt-0.5">
                <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-soft-blue">
                  {it.runsCount} {it.runsCount === 1 ? 'corrida' : 'corridas'}
                </span>
                {it.hasValidation && (
                  <span className="rounded-full bg-success-surface px-2 py-0.5 text-[11px] font-medium text-success">
                    ✓ Validada
                  </span>
                )}
                {it.hasSummary && (
                  <span className="rounded-full bg-success-surface px-2 py-0.5 text-[11px] font-medium text-success">
                    ✓ Resumida
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>

        {/* Detalle */}
        <div className="space-y-4 lg:self-start">
          {detailLoading && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner className="h-4 w-4" /> Cargando atención…
            </p>
          )}
          {!detailLoading && selected && (
            <>
              <section className="card space-y-2">
                <div className="flex items-center gap-2">
                  <IconTranscript className="h-5 w-5 text-soft-blue" />
                  <h2 className="text-base font-semibold text-ink">Dictado enviado</h2>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  {selected.transcript}
                </p>
              </section>

              <section className="card space-y-3">
                <h2 className="text-base font-semibold text-ink">
                  Corridas de extracción ({selected.runs.length}
                  {selected.runsCount > selected.runs.length
                    ? ` de ${selected.runsCount} — se conservan las últimas`
                    : ''}
                  )
                </h2>
                {selected.runs.map((run, i) => (
                  <details key={run.at + i} className="rounded-lg border border-stroke p-3">
                    <summary className="cursor-pointer text-sm font-medium text-ink">
                      {fmtFecha(run.at)} · {STT_LABEL[run.stt] ?? run.stt} · {run.engine} ·{' '}
                      {run.model}
                    </summary>
                    <div className="mt-3 space-y-3">
                      <p className="text-[11px] text-muted">
                        Esta corrida procesó {run.transcriptChars} caracteres del dictado.
                      </p>
                      <details className="rounded-md bg-surface/40 p-2">
                        <summary className="cursor-pointer text-xs font-semibold text-muted">
                          Prompt utilizado
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink">
                          {run.prompt}
                        </pre>
                      </details>
                      <DataExtraction extractedData={run.result} isExtracting={false} />
                    </div>
                  </details>
                ))}
              </section>

              {selected.validation && (
                <section className="card space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-ink">
                      Última validación de consistencia
                    </h2>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        selected.validation.consistent
                          ? 'bg-success-surface text-success'
                          : 'bg-danger-surface text-danger'
                      }`}
                    >
                      {selected.validation.consistent ? 'Consistente' : 'Inconsistente'}
                    </span>
                  </div>
                  <MetaYPrompt
                    engine={selected.validation.engine}
                    model={selected.validation.model}
                    prompt={selected.validation.prompt}
                  />
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                    {selected.validation.observations || 'Sin observaciones.'}
                  </p>
                </section>
              )}

              {selected.summary && (
                <section className="card space-y-3">
                  <h2 className="text-base font-semibold text-ink">Último resumen clínico</h2>
                  <MetaYPrompt
                    engine={selected.summary.engine}
                    model={selected.summary.model}
                    prompt={selected.summary.prompt}
                  />
                  {Object.entries(selected.summary.sections).map(([k, v]) =>
                    v ? (
                      <div key={k}>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                          {k}
                        </p>
                        <p className="text-sm leading-relaxed text-ink">{v}</p>
                      </div>
                    ) : null
                  )}
                </section>
              )}
            </>
          )}
          {!detailLoading && !selected && items.length > 0 && (
            <div className="card text-sm text-muted">
              Elige una atención de la lista para ver su detalle.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
