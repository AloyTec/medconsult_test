'use client'

import { useState } from 'react'
import { LogoMark } from '../components/icons'

/** Pantalla del código de acceso compartido (se entrega por WhatsApp). */
export default function AccesoPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSending(true)
    try {
      const res = await fetch('/api/acceso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error ?? 'No se pudo validar el código.')
        return
      }
      // Recarga completa para que el proxy re-evalúe la cookie en todas las rutas.
      window.location.assign('/prompts')
    } catch {
      setError('No se pudo conectar con el servidor. Intenta de nuevo.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 py-16">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface text-primary">
        <LogoMark className="h-6 w-6" />
      </span>
      <div className="text-center">
        <h1 className="text-xl font-bold text-primary">Acceso al estudio de prompts</h1>
        <p className="mt-1 text-sm text-muted">
          Ingresa el código de acceso que te compartió el equipo.
        </p>
      </div>
      <form onSubmit={submit} className="card w-full space-y-3">
        <label htmlFor="code" className="sr-only">
          Código de acceso
        </label>
        <input
          id="code"
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Código de acceso"
          autoFocus
          className="field"
        />
        <button
          type="submit"
          disabled={sending || code.trim().length === 0}
          className="inline-flex h-11 w-full items-center justify-center rounded-[10px] bg-primary text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-disabled"
        >
          {sending ? 'Validando…' : 'Entrar'}
        </button>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-surface px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </div>
  )
}
