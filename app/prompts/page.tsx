'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { EXTRACTION_PROMPT } from '@/lib/extraction-schema'
import { CONSISTENCY_PROMPT, SUMMARIZE_PROMPT } from '@/lib/prompts'
import { DEFAULT_STT_PROMPT } from '@/lib/stt-vocabulary'
import type { ExtractedData } from '@/lib/types'
import { useVoiceRecording } from '@/lib/hooks/useVoiceRecording'

interface PromptVersion {
  version: number
  lastModified: string
  value: string
}

type PromptKey = 'extraction' | 'consistency' | 'summarize'

const DEFAULT_PROMPTS: Record<PromptKey, string> = {
  extraction: EXTRACTION_PROMPT,
  consistency: CONSISTENCY_PROMPT,
  summarize: SUMMARIZE_PROMPT,
}

// The three prompts that run in the backend pipeline, surfaced as editor tabs.
// `needsData` → the action runs on the extracted data (so Extraer must run first).
const PROMPT_TABS: {
  key: PromptKey
  label: string
  action: string
  note: string
  needsData: boolean
}[] = [
  {
    key: 'extraction',
    label: 'Extracción',
    action: 'Extraer',
    note: 'Estas instrucciones convierten el dictado en campos clínicos estructurados.',
    needsData: false,
  },
  {
    key: 'consistency',
    label: 'Validación',
    action: 'Validar',
    note: 'Revisa la consistencia clínica de la consulta extraída (alergia vs. fármaco, diagnóstico vs. motivo, dosis, omisiones).',
    needsData: true,
  },
  {
    key: 'summarize',
    label: 'Resumen',
    action: 'Resumir',
    note: 'Resume de forma concisa cada sección clínica de la consulta extraída.',
    needsData: true,
  },
]
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

// Modelos de Bedrock seleccionables (inference profiles global.* — ~10% más baratos que us.*).
const BEDROCK_MODELS = [
  { id: 'global.anthropic.claude-haiku-4-5-20251001-v1:0', label: 'Haiku 4.5 · rápido y económico' },
  { id: 'global.anthropic.claude-sonnet-4-6', label: 'Sonnet 4.6 · balanceado' },
  { id: 'global.anthropic.claude-opus-4-6-v1', label: 'Opus 4.6 · máxima calidad' },
]

export default function PromptPlaygroundPage() {
  const [promptKey, setPromptKey] = useState<PromptKey>('extraction')
  const [prompts, setPrompts] = useState<Record<PromptKey, string>>(DEFAULT_PROMPTS)
  const [baselines, setBaselines] = useState<Record<PromptKey, string>>(DEFAULT_PROMPTS)
  const prompt = prompts[promptKey] // active editor value
  const setPrompt = (value: string) => setPrompts((p) => ({ ...p, [promptKey]: value }))
  const currentDefault = DEFAULT_PROMPTS[promptKey]
  const activeTab = PROMPT_TABS.find((t) => t.key === promptKey)!
  const [transcript, setTranscript] = useState('')
  const [result, setResult] = useState<ExtractedData | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  // Resultados de validación y resumen (corren sobre los datos extraídos).
  const [validation, setValidation] = useState<{ consistent: boolean; observations: string } | null>(
    null
  )
  const [summary, setSummary] = useState<Record<string, string> | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [isSummarizing, setIsSummarizing] = useState(false)
  const [valMs, setValMs] = useState<number | null>(null)
  const [sumMs, setSumMs] = useState<number | null>(null)
  const [engine, setEngine] = useState<'openai' | 'bedrock'>('openai')
  const [model, setModel] = useState('gpt-4o-mini')
  const [models, setModels] = useState<string[]>([])
  const [bedrockModel, setBedrockModel] = useState(BEDROCK_MODELS[0].id)
  const [stt, setStt] = useState<'openai' | 'transcribe'>('openai')
  const [sttPrompt, setSttPrompt] = useState(DEFAULT_STT_PROMPT)
  // Historial de versiones (SSM versiona en cada Guardar).
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<PromptVersion[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  // Load the saved prompt from the isolated test SSM namespace on mount; the API falls
  // back to the bundled default when nothing is saved yet.
  useEffect(() => {
    fetch('/api/prompts')
      .then((r) => r.json())
      .then((d) => {
        const next: Partial<Record<PromptKey, string>> = {}
        for (const k of ['extraction', 'consistency', 'summarize'] as PromptKey[]) {
          const v = d?.prompts?.[k]?.value
          if (typeof v === 'string' && v.length > 0) next[k] = v
        }
        if (Object.keys(next).length > 0) {
          setPrompts((p) => ({ ...p, ...next }))
          setBaselines((b) => ({ ...b, ...next }))
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

  const promptEdited = prompts[promptKey] !== baselines[promptKey]
  const promptIsDefault = prompts[promptKey] === currentDefault

  async function savePrompt() {
    // Guard: don't persist a degenerate prompt, and keep the data marker for the
    // validation/summary prompts (without it the consultation data isn't injected).
    const value = prompts[promptKey]
    if (value.trim().length < 20) {
      setSaveMsg('El prompt es demasiado corto para guardarse. Escribe instrucciones reales.')
      return
    }
    if (activeTab.needsData && !value.includes('$CONSULTATION_DATA')) {
      setSaveMsg('Falta el marcador $CONSULTATION_DATA (ahí se inyectan los datos de la consulta).')
      return
    }

    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: promptKey, value }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveMsg(data?.error ?? `Error al guardar (${res.status})`)
        return
      }
      setBaselines((b) => ({ ...b, [promptKey]: value }))
      setSaveMsg('Guardado en SSM ✓ (nueva versión)')
      if (historyOpen) loadHistory() // refresh so the new version shows up
    } catch {
      setSaveMsg('No se pudo guardar (problema de red).')
    } finally {
      setSaving(false)
    }
  }

  async function loadHistory() {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const res = await fetch(`/api/prompts/history?key=${promptKey}`)
      const data = await res.json()
      if (!res.ok) {
        setHistoryError(data?.error ?? `No se pudo cargar el historial (${res.status}).`)
        setHistory([])
        return
      }
      setHistory(Array.isArray(data?.versions) ? data.versions : [])
    } catch {
      setHistoryError('No se pudo cargar el historial (problema de red).')
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }

  function toggleHistory() {
    const next = !historyOpen
    setHistoryOpen(next)
    if (next) loadHistory()
  }

  function loadVersion(v: PromptVersion) {
    setPrompt(v.value)
    setHistoryOpen(false)
    setSaveMsg(`Cargada la versión ${v.version} en el editor (aún sin guardar).`)
  }

  function selectTab(key: PromptKey) {
    setPromptKey(key)
    setHistoryOpen(false) // el historial es por prompt; ciérralo al cambiar de pestaña
    setSaveMsg(null)
  }

  // Modelo activo para los tres carriles (OpenAI: lista seleccionable; Bedrock: Haiku/Sonnet/Opus).
  const activeModel = engine === 'openai' ? model : bedrockModel

  // Live dictation (faithful to Flutter): mic → realtime transcript → 2s-debounced
  // extraction with the extraction prompt → fields fill in as you speak.
  const voice = useVoiceRecording({
    getPrompt: () => prompts.extraction,
    getEngine: () => engine,
    getModel: () => activeModel,
    getStt: () => stt,
    getSttPrompt: () => sttPrompt,
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
          prompt: prompts.extraction,
          engine,
          model: activeModel,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? `La extracción falló (${res.status}).`)
        return
      }
      setResult(data as ExtractedData)
      setLatencyMs(Math.round(performance.now() - startedAt))
      // Los resultados de validación/resumen quedan obsoletos al re-extraer.
      setValidation(null)
      setSummary(null)
    } catch {
      setError('No se pudo conectar con el servidor. Intenta de nuevo.')
    } finally {
      setIsExtracting(false)
    }
  }

  async function runValidate() {
    if (!result) {
      setError('Primero extrae los datos de la consulta (pestaña Extracción).')
      return
    }
    setError(null)
    setIsValidating(true)
    const startedAt = performance.now()
    try {
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: result, prompt: prompts.consistency, engine, model: activeModel }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? `La validación falló (${res.status}).`)
        return
      }
      setValidation({ consistent: data.consistent === true, observations: data.observations ?? '' })
      setValMs(Math.round(performance.now() - startedAt))
    } catch {
      setError('No se pudo conectar con el servidor. Intenta de nuevo.')
    } finally {
      setIsValidating(false)
    }
  }

  async function runSummarize() {
    if (!result) {
      setError('Primero extrae los datos de la consulta (pestaña Extracción).')
      return
    }
    setError(null)
    setIsSummarizing(true)
    const startedAt = performance.now()
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: result, prompt: prompts.summarize, engine, model: activeModel }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? `El resumen falló (${res.status}).`)
        return
      }
      setSummary(data as Record<string, string>)
      setSumMs(Math.round(performance.now() - startedAt))
    } catch {
      setError('No se pudo conectar con el servidor. Intenta de nuevo.')
    } finally {
      setIsSummarizing(false)
    }
  }

  // Acción contextual de la pestaña activa.
  function runActive() {
    if (promptKey === 'extraction') return runExtraction()
    if (promptKey === 'consistency') return runValidate()
    return runSummarize()
  }
  const isRunningActive =
    promptKey === 'extraction'
      ? isExtracting
      : promptKey === 'consistency'
        ? isValidating
        : isSummarizing
  const activeMs =
    promptKey === 'extraction' ? latencyMs : promptKey === 'consistency' ? valMs : sumMs

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
          Aquí pruebas y afinas las instrucciones que sigue la IA para llenar la ficha clínica a
          partir de tu dictado. En 4 pasos:
        </p>
        <ol className="max-w-2xl list-none space-y-2 text-sm leading-relaxed text-ink">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-bold text-primary">
              1
            </span>
            <span>
              <strong>Graba tu dictado una vez</strong> con el botón <em>Dictar</em>, o elige un
              ejemplo ya preparado.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-bold text-primary">
              2
            </span>
            <span>
              Presiona <strong>Extraer</strong> y observa cómo se llenan los campos clínicos
              (paciente, antecedentes, diagnóstico, plan…).
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-bold text-primary">
              3
            </span>
            <span>
              <strong>Edita el prompt</strong> (las instrucciones de la IA) y vuelve a{' '}
              <strong>Extraer</strong>: verás cómo cambia el resultado sobre el mismo dictado, sin
              volver a grabar.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-bold text-primary">
              4
            </span>
            <span>
              Cuando un prompt te convenza, presiona <strong>Guardar</strong>. Cada vez que guardas
              se crea una <strong>nueva versión</strong> que puedes recuperar después con{' '}
              <em>Ver versiones</em>.
            </span>
          </li>
        </ol>
        <p className="max-w-2xl text-sm font-medium text-soft-blue">
          Usa siempre datos de pacientes ficticios — no ingreses información de pacientes reales.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Columna izquierda: editor */}
        <div className="space-y-6">
          {/* Prompt */}
          <section className="card space-y-3">
            {/* Tabs: los 3 prompts del pipeline backend (Extracción → Validación → Resumen). */}
            <div className="inline-flex rounded-lg border border-stroke bg-surface/40 p-0.5">
              {PROMPT_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => selectTab(t.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    promptKey === t.key ? 'bg-primary text-white' : 'text-muted hover:text-primary'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <IconSparkles className="h-5 w-5 text-soft-blue" />
                <h2 className="text-base font-semibold text-ink">Prompt de {activeTab.label.toLowerCase()}</h2>
                {promptEdited && (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-soft-blue">
                    sin guardar
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleHistory}
                  className="text-sm font-medium text-soft-blue underline-offset-2 hover:text-primary hover:underline"
                >
                  Ver versiones
                </button>
                <button
                  type="button"
                  onClick={() => setPrompt(currentDefault)}
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
              {activeTab.note} Cada <strong className="font-medium">Guardar</strong> crea una{' '}
              <strong className="font-medium">nueva versión</strong> (puedes volver a una anterior
              con <strong className="font-medium">Ver versiones</strong>). Es un entorno de prueba:
              no afecta la app de los doctores.
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

            {/* Historial de versiones (SSM). Click en una versión → la carga en el editor. */}
            {historyOpen && (
              <div className="rounded-lg border border-stroke bg-surface/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink">
                    Versiones guardadas (más reciente primero)
                  </span>
                  <button
                    type="button"
                    onClick={() => setHistoryOpen(false)}
                    className="text-xs font-medium text-muted hover:text-primary"
                  >
                    Cerrar
                  </button>
                </div>
                {historyLoading && (
                  <p className="flex items-center gap-2 text-xs text-muted">
                    <Spinner className="h-3.5 w-3.5" /> Cargando historial…
                  </p>
                )}
                {historyError && <p className="text-xs text-danger">{historyError}</p>}
                {!historyLoading && !historyError && history.length === 0 && (
                  <p className="text-xs text-muted">
                    Todavía no hay versiones guardadas. Edita el prompt y presiona Guardar.
                  </p>
                )}
                {!historyLoading && history.length > 0 && (
                  <ul className="space-y-1.5">
                    {history.map((v) => (
                      <li key={v.version}>
                        <button
                          type="button"
                          onClick={() => loadVersion(v)}
                          className="flex w-full items-start gap-3 rounded-md border border-stroke bg-white px-3 py-2 text-left transition-colors hover:border-primary"
                        >
                          <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold text-primary">
                            v{v.version}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[11px] text-muted">{v.lastModified}</span>
                            <span className="block truncate text-xs text-ink">
                              {v.value.slice(0, 90)}
                              {v.value.length > 90 ? '…' : ''}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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

            {/* Controles: una fila por control (IA de extracción / Motor de dictado). */}
            <div className="flex flex-col gap-2.5 rounded-lg border border-stroke bg-surface/40 p-3">
              {/* Fila 1 — IA de extracción: OpenAI (modelo seleccionable) | Bedrock (Haiku/Sonnet/Opus) */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-full text-xs font-semibold text-muted sm:w-56">
                  IA para extracción de datos clínicos
                </span>
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
                      {e === 'openai' ? 'OpenAI' : 'Bedrock'}
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
                  <label className="flex items-center gap-2 text-xs text-muted">
                    Modelo
                    <select
                      value={bedrockModel}
                      onChange={(e) => setBedrockModel(e.target.value)}
                      className="rounded-md border border-stroke bg-white px-2 py-1 text-xs text-ink focus:border-primary focus:outline-none"
                    >
                      {BEDROCK_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {/* Fila 2 — Motor de dictado (STT): OpenAI Realtime | AWS Transcribe */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-full text-xs font-semibold text-muted sm:w-56">
                  Motor de dictado (STT)
                </span>
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

              {/* Fila 3 — Vocabulario del dictado. OpenAI: campo editable; Transcribe: diccionario aparte. */}
              {stt === 'openai' ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-muted">
                    Vocabulario del dictado (OpenAI)
                  </span>
                  <textarea
                    value={sttPrompt}
                    onChange={(e) => setSttPrompt(e.target.value)}
                    disabled={recording}
                    rows={4}
                    spellCheck={false}
                    className="field text-xs leading-relaxed disabled:opacity-60"
                    placeholder="Términos que el dictado debe reconocer bien (fármacos, abreviaturas, anatomía)…"
                  />
                  <span className="text-[11px] text-muted">
                    Le indica al reconocedor de voz qué términos clínicos/chilenos esperar. Edítalo y
                    vuelve a dictar para comparar.
                  </span>
                </div>
              ) : (
                <p className="text-[11px] leading-relaxed text-muted">
                  AWS Transcribe se afina con un <strong>diccionario propio</strong> que se crea una
                  sola vez en AWS, no desde aquí.{' '}
                  <Link
                    href="/diccionario"
                    className="font-semibold text-soft-blue underline-offset-2 hover:text-primary hover:underline"
                  >
                    Ver diccionario recomendado →
                  </Link>
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={runActive}
                disabled={isRunningActive || recording || (activeTab.needsData && !result)}
                title={
                  activeTab.needsData && !result
                    ? 'Primero extrae los datos en la pestaña Extracción'
                    : undefined
                }
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-disabled"
              >
                {isRunningActive ? (
                  <>
                    <Spinner className="h-4 w-4" /> {activeTab.action}…
                  </>
                ) : (
                  <>
                    <IconSparkles className="h-4 w-4" /> {activeTab.action}
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

              {activeMs != null && !isRunningActive && !recording && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success-surface px-3 py-1 text-xs font-medium text-success">
                  <IconClipboardCheck className="h-3.5 w-3.5" /> Listo · {activeMs} ms
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

        {/* Columna derecha: resultados del pipeline (extracción → validación → resumen) */}
        <div className="space-y-4 lg:self-start">
          <DataExtraction extractedData={result} isExtracting={isExtracting || voice.state.isExtracting} />

          {validation && (
            <section className="card space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-ink">Validación de consistencia</h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    validation.consistent
                      ? 'bg-success-surface text-success'
                      : 'bg-danger-surface text-danger'
                  }`}
                >
                  {validation.consistent ? 'Consistente' : 'Inconsistente'}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {validation.observations || 'Sin observaciones.'}
              </p>
            </section>
          )}

          {summary && (
            <section className="card space-y-3">
              <h2 className="text-base font-semibold text-ink">Resumen clínico</h2>
              {(
                [
                  ['antecedentes', 'Antecedentes'],
                  ['motivoConsulta', 'Motivo de consulta'],
                  ['examenFisico', 'Examen físico'],
                  ['diagnostico', 'Diagnóstico'],
                  ['planTrabajo', 'Plan de trabajo'],
                ] as const
              ).map(([k, label]) =>
                summary[k] ? (
                  <div key={k}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      {label}
                    </p>
                    <p className="text-sm leading-relaxed text-ink">{summary[k]}</p>
                  </div>
                ) : null
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
