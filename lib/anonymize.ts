// lib/anonymize.ts
// Server-only. Anonimiza lo que se PERSISTE en el historial — las respuestas en vivo
// de la API mantienen datos reales (el doctor los necesita para su ficha). Best-effort
// declarado: menciones que la IA no extrajo pueden quedar (aceptado en el spec).
import type { ExtractedData, PatientData } from './types'

/** Seudónimo determinístico por atención (igual entre corridas): "Paciente 7F3A". */
export function pseudonymFor(atencionId: string): string {
  let h = 5381
  for (let i = 0; i < atencionId.length; i++) {
    h = ((h * 33) ^ atencionId.charCodeAt(i)) >>> 0
  }
  return `Paciente ${h.toString(36).slice(-4).toUpperCase()}`
}

// RUT chileno con o sin puntos/guión: 12.345.678-5, 12345678-5, 123456785.
// Intencionalmente sobre-inclusivo: puede enmascarar otros números de 8-9 dígitos
// (teléfonos, fechas) — sobre-redactar es la dirección segura.
const RUT_RE = /\b\d{1,2}\.?\d{3}\.?\d{3}\s?-?\s?[\dkK]\b/g

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Reemplaza (case-insensitive) los identificadores extraídos + cualquier RUT.
 * Identificadores de <3 chars se ignoran para no romper palabras comunes.
 */
export function scrubText(
  text: string,
  patient: PatientData | null | undefined,
  pseudonym: string
): string {
  let out = text
  const values = [patient?.name, patient?.lastName, patient?.document].filter(
    (v): v is string => typeof v === 'string' && v.trim().length >= 3
  )
  for (const v of values) {
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(v.trim())}(?![\\p{L}\\p{N}])`, 'giu'),
      pseudonym
    )
  }
  // Nombre y apellido adyacentes ("Juan Pérez") producen el seudónimo dos veces
  // seguidas: colapsa las repeticiones en una.
  out = out.replace(new RegExp(`(${escapeRe(pseudonym)})(\\s+\\1)+`, 'g'), '$1')
  return out.replace(RUT_RE, 'RUT-OCULTO')
}

/** Copia de la extracción con identificadores reemplazados (solo para persistir). */
export function scrubExtractedData(data: ExtractedData, pseudonym: string): ExtractedData {
  const sections = { ...data.clinicalSections }
  for (const k of Object.keys(sections) as (keyof typeof sections)[]) {
    const v = sections[k]
    if (typeof v === 'string') sections[k] = scrubText(v, data.patient, pseudonym)
  }
  return {
    patient: { ...data.patient, name: pseudonym, lastName: null, document: null },
    clinicalSections: sections,
  }
}
