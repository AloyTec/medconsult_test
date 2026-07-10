/**
 * @jest-environment node
 */
// __tests__/anonymize.test.ts
// La anonimización aplica SOLO a lo persistido (spec §Anonimización): seudónimo
// determinístico + reemplazo de identificadores extraídos + regex RUT best-effort.
import { pseudonymFor, scrubText, scrubExtractedData } from '@/lib/anonymize'
import type { ExtractedData } from '@/lib/types'

const PATIENT = {
  name: 'Juan',
  lastName: 'Pérez',
  age: 45,
  document: '12345678-5',
  docType: 1,
}

describe('pseudonymFor', () => {
  it('is deterministic per atención and looks like "Paciente XXXX"', () => {
    const a = pseudonymFor('01JZXA0000000000000000000A')
    expect(a).toBe(pseudonymFor('01JZXA0000000000000000000A'))
    expect(a).toMatch(/^Paciente [0-9A-Z]{1,4}$/)
    expect(a).not.toBe(pseudonymFor('01JZXA0000000000000000000B'))
  })
})

describe('scrubText', () => {
  const P = 'Paciente A1B2'

  it('replaces name and lastName case-insensitively', () => {
    const out = scrubText('paciente JUAN pérez consulta', PATIENT, P)
    expect(out).not.toMatch(/juan/i)
    expect(out).not.toMatch(/pérez/i)
    expect(out).toContain(P)
  })

  it('masks RUTs in dotted and plain formats', () => {
    const out = scrubText('RUT 12.345.678-5 o 12345678-5', PATIENT, P)
    expect(out).not.toContain('12.345.678-5')
    expect(out).not.toContain('12345678-5')
    expect(out).toContain('RUT-OCULTO')
  })

  it('does not replace identifiers shorter than 3 chars (avoids nuking substrings)', () => {
    const out = scrubText('Alto y ancho', { ...PATIENT, name: 'Al', lastName: null, document: null }, P)
    expect(out).toBe('Alto y ancho')
  })

  it('handles null patient', () => {
    expect(scrubText('sin datos', null, P)).toBe('sin datos')
  })
})

describe('scrubExtractedData', () => {
  it('pseudonymizes patient fields and scrubs sections', () => {
    const data: ExtractedData = {
      patient: PATIENT,
      clinicalSections: {
        antecedentes: 'Juan Pérez con gastritis',
        anamnesis: null,
        examenFisico: 'sin hallazgos',
        diagnostico: 'gastritis aguda',
        plan: 'control de Juan en una semana',
      },
    }
    const out = scrubExtractedData(data, 'Paciente A1B2')
    expect(out.patient.name).toBe('Paciente A1B2')
    expect(out.patient.lastName).toBeNull()
    expect(out.patient.document).toBeNull()
    expect(out.patient.age).toBe(45) // edad se conserva (no identifica por sí sola)
    expect(out.clinicalSections.antecedentes).not.toMatch(/juan|pérez/i)
    expect(out.clinicalSections.plan).not.toMatch(/juan/i)
    expect(out.clinicalSections.examenFisico).toBe('sin hallazgos')
    // el original NO se muta (la respuesta en vivo lleva datos reales)
    expect(data.patient.name).toBe('Juan')
    expect(data.clinicalSections.antecedentes).toContain('Juan')
  })
})
