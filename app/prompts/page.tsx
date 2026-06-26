'use client'

import { useEffect, useState } from 'react'
import { EXTRACTION_PROMPT } from '@/lib/extraction-schema'
import type { ExtractedData } from '@/lib/types'
import { useVoiceRecording } from '@/lib/hooks/useVoiceRecording'
import { DataExtraction } from '../components/DataExtraction'
import { IconSparkles, IconTranscript, IconClipboardCheck, IconMic, Spinner } from '../components/icons'

function fmt(s: number): string {
  const m = Math.floor(s / 60).toString().padStart(2, '0')
  const sec = (s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

/**
 * Prompt Playground (POC View 1 — the #1 priority).
 *
 * The doctor/owner edits the extraction prompt and sees the structured clinical
 * fields change on the same dictation — the tight "edit → see effect" loop, on text,
 * with no audio needed. The edited prompt is sent to the server-side /api/extract
 * route per request (the API key stays on the server). The real-time audio lane
 * (faithful to Flutter) plugs into this same extraction step later.
 */

// Transcripciones SINTÉTICAS (pacientes ficticios, sin PHI real) para iterar rápido.
const SAMPLE_TRANSCRIPTS: { label: string; text: string }[] = [
  {
    label: 'Control general',
    text:
      'Paciente Juan Pérez, 45 años, RUT 12.345.678-5. Viene por cuadro de tres días de ' +
      'dolor abdominal en epigastrio, asociado a náuseas. Antecedentes de gastritis crónica y ' +
      'tabaquismo. Al examen físico, abdomen blando, depresible, doloroso a la palpación en ' +
      'epigastrio, sin signos peritoneales. Impresión diagnóstica gastritis aguda. Plan: ' +
      'omeprazol 20 miligramos cada doce horas por catorce días, dieta blanda, control en una semana.',
  },
  {
    label: 'Urgencia (sin documento)',
    text:
      'Paciente sin documento, mujer de 30 años. Consulta por cefalea intensa de inicio súbito ' +
      'hace dos horas, la peor de su vida, con fotofobia. Sin antecedentes mórbidos. Examen ' +
      'físico vigil, rigidez de nuca presente, sin déficit focal. Diagnóstico: descartar ' +
      'hemorragia subaracnoidea. Plan: TAC de cerebro urgente, hospitalización, evaluación por neurología.',
  },
]

export default function PromptPlaygroundPage() {
  const [prompt, setPrompt] = useState(EXTRACTION_PROMPT)
  const [baseline, setBaseline] = useState(EXTRACTION_PROMPT) // last loaded/saved value (from SSM)
  const [transcript, setTranscript] = useState('')
  const [result, setResult] = useState<ExtractedData | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [engine, setEngine] = useState<'openai' | 'bedrock'>('openai')
  const [model, setModel] = useState('gpt-4o-mini')
  const [models, setModels] = useState<string[]>([])
  const [stt, setStt] = useState<'openai' | 'transcribe'>('openai')

  // Load the saved prompt from the isolated test SSM namespace on mount; the API falls
  // back to the bundled default when nothing is saved yet.
  useEffect(() => {
    fetch('/api/prompts')
      .then((r) => r.json())
      .then((d) => {
        const v = d?.prompts?.extraction?.value
        if (typeof v === 'string' && v.length > 0) {
          setPrompt(v)
          setBaseline(v)
        }
      })
      .catch(() => {})
  }, [])

  // Load the selectable OpenAI models (the client wants to swap + test models).
  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.models) && d.models.length > 0) {
          setModels(d.models)
          if (!d.models.includes(model)) setModel(d.models.includes('gpt-4o-mini') ? 'gpt-4o-mini' : d.models[0])
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const promptEdited = prompt !== baseline
  const promptIsDefault = prompt === EXTRACTION_PROMPT

  async function savePrompt() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'extraction', value: prompt }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveMsg(data?.error ?? `Error al guardar (${res.status})`)
        return
      }
      setBaseline(prompt)
      setSaveMsg('Guardado en SSM ✓')
    } catch {
      setSaveMsg('No se pudo guardar (problema de red).')
    } finally {
      setSaving(false)
    }
  }

  // Live dictation (faithful to Flutter): mic → realtime transcript → 2s-debounced
  // extraction with the *current* (edited) prompt → fields fill in as you speak.
  const voice = useVoiceRecording({
    getPrompt: () => prompt,
    getEngine: () => engine,
    getModel: () => (engine === 'openai' ? model : undefined),
    getStt: () => stt,
  })
  const recording = voice.state.isRecording

  useEffect(() => {
    if (voice.state.extractedData) setResult(voice.state.extractedData)
  }, [voice.state.extractedData])

  useEffect(() => {
    if (voice.state.isRecording) {
      setTranscript((voice.state.fullTranscript + ' ' + voice.state.liveTranscript).trim())
    }
  }, [voice.state.fullTranscript, voice.state.liveTranscript, voice.state.isRecording])

  async function runExtraction() {
    if (!transcript.trim()) {
      setError('Primero pega o elige una transcripción de ejemplo.')
      return
    }
    setError(null)
    setIsExtracting(true)
    const startedAt = performance.now()
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          prompt,
          engine,
          model: engine === 'openai' ? model : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? `La extracción falló (${res.status}).`)
        return
      }
      setResult(data as ExtractedData)
      setLatencyMs(Math.round(performance.now() - startedAt))
    } catch {
      setError('No se pudo conectar con el servidor. Intenta de nuevo.')
    } finally {
      setIsExtracting(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Encabezado */}
      <header className="space-y-3">
        <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-primary">
          <IconSparkles className="h-3.5 w-3.5" /> Editor de prompts clínicos
        </span>
        <h1 className="text-3xl font-bold text-primary">
          Ajusta cómo la IA entiende el dictado
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Edita el prompt de extracción y mira, al instante, cómo se llenan los campos clínicos
          sobre la misma transcripción. Itera sin volver a grabar. La extracción corre en el
          servidor (la clave nunca llega al navegador).{' '}
          <span className="font-medium text-soft-blue">
            Usa los ejemplos: no ingreses datos de pacientes reales.
          </span>
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Columna izquierda: editor */}
        <div className="space-y-6">
          {/* Prompt */}
          <section className="card space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <IconSparkles className="h-5 w-5 text-soft-blue" />
                <h2 className="text-base font-semibold text-ink">Prompt de extracción</h2>
                {promptEdited && (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-soft-blue">
                    sin guardar
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPrompt(EXTRACTION_PROMPT)}
                  disabled={promptIsDefault}
                  className="text-sm font-medium text-soft-blue underline-offset-2 hover:text-primary hover:underline disabled:text-disabled disabled:no-underline"
                >
                  Restaurar original
                </button>
                <button
                  type="button"
                  onClick={savePrompt}
                  disabled={saving || !promptEdited}
                  className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-disabled"
                >
                  {saving ? (
                    <>
                      <Spinner className="h-4 w-4" /> Guardando…
                    </>
                  ) : (
                    'Guardar'
                  )}
                </button>
              </div>
            </div>
            <p className="text-xs text-muted">
              Estas instrucciones definen cómo la IA convierte el dictado en campos estructurados.
              <strong className="font-medium"> Guardar</strong> persiste en SSM de prueba —
              sobrevive el reload y <strong className="font-medium">no</strong> toca producción.
            </p>
            {saveMsg && (
              <p
                className={`text-xs font-medium ${
                  saveMsg.includes('✓') ? 'text-success' : 'text-danger'
                }`}
              >
                {saveMsg}
              </p>
            )}
            <label htmlFor="prompt" className="sr-only">
              Prompt de extracción
            </label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={15}
              spellCheck={false}
              className="field font-mono text-xs leading-relaxed"
            />
          </section>

          {/* Transcripción */}
          <section className="card space-y-3">
            <div className="flex items-center gap-2">
              <IconTranscript className="h-5 w-5 text-soft-blue" />
              <h2 className="text-base font-semibold text-ink">Dictado (texto)</h2>
            </div>
            <p className="text-xs text-muted">
              Pega un dictado o empieza con un ejemplo sintético.
            </p>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_TRANSCRIPTS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setTranscript(s.text)}
                  className="rounded-full border border-stroke px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-soft-blue hover:bg-surface hover:text-primary"
                >
                  {s.label}
                </button>
              ))}
            </div>
            <label htmlFor="transcript" className="sr-only">
              Transcripción del dictado
            </label>
            <textarea
              id="transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={6}
              placeholder="Pega o escribe el dictado del médico (datos ficticios)…"
              className="field"
            />

            {/* Motor de extracción: OpenAI (modelo seleccionable) | Bedrock Haiku */}
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-stroke bg-surface/40 p-3">
              <span className="text-xs font-semibold text-muted">Motor</span>
              <div className="inline-flex rounded-lg border border-stroke bg-white p-0.5">
                {(['openai', 'bedrock'] as const).map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEngine(e)}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                      engine === e ? 'bg-primary text-white' : 'text-muted hover:text-primary'
                    }`}
                  >
                    {e === 'openai' ? 'OpenAI' : 'Bedrock (Haiku)'}
                  </button>
                ))}
              </div>
              {engine === 'openai' ? (
                <label className="flex items-center gap-2 text-xs text-muted">
                  Modelo
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="rounded-md border border-stroke bg-white px-2 py-1 text-xs text-ink focus:border-primary focus:outline-none"
                  >
                    {(models.length > 0 ? models : [model]).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="font-mono text-[11px] text-muted">
                  us.anthropic.claude-haiku-4-5
                </span>
              )}

              <span className="mx-1 h-4 w-px bg-stroke" aria-hidden />
              <span className="text-xs font-semibold text-muted">STT (dictado)</span>
              <div className="inline-flex rounded-lg border border-stroke bg-white p-0.5">
                {(['openai', 'transcribe'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStt(s)}
                    disabled={recording}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                      stt === s ? 'bg-soft-blue text-white' : 'text-muted hover:text-primary'
                    }`}
                  >
                    {s === 'openai' ? 'OpenAI Realtime' : 'AWS Transcribe'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={runExtraction}
                disabled={isExtracting || recording}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-disabled"
              >
                {isExtracting ? (
                  <>
                    <Spinner className="h-4 w-4" /> Extrayendo…
                  </>
                ) : (
                  <>
                    <IconSparkles className="h-4 w-4" /> Extraer
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => (recording ? voice.stop() : voice.start())}
                disabled={voice.state.isProcessing}
                className={`inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
                  recording
                    ? 'bg-danger-surface text-danger hover:bg-[#ffd9d9]'
                    : 'border border-primary bg-white text-primary hover:bg-surface disabled:border-disabled disabled:text-disabled'
                }`}
              >
                {recording ? (
                  <>
                    <span className="h-2.5 w-2.5 rounded-full bg-danger" /> Detener · {fmt(voice.state.elapsedSeconds)}
                  </>
                ) : voice.state.isProcessing ? (
                  <>
                    <Spinner className="h-4 w-4" /> Conectando…
                  </>
                ) : (
                  <>
                    <IconMic className="h-4 w-4" /> Dictar
                  </>
                )}
              </button>

              {latencyMs != null && !isExtracting && !recording && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success-surface px-3 py-1 text-xs font-medium text-success">
                  <IconClipboardCheck className="h-3.5 w-3.5" /> Listo · {latencyMs} ms
                </span>
              )}
              {recording && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-medium text-soft-blue">
                  Escuchando… los campos se llenan al pausar
                </span>
              )}
            </div>
            {(error || voice.state.error) && (
              <p
                role="alert"
                className="rounded-lg bg-danger-surface px-3 py-2 text-sm text-danger"
              >
                {error ?? voice.state.error}
              </p>
            )}
          </section>
        </div>

        {/* Columna derecha: resultados (reusa el componente existente) */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <DataExtraction extractedData={result} isExtracting={isExtracting || voice.state.isExtracting} />
        </div>
      </div>
    </div>
  )
}
