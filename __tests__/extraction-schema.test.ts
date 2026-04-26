// __tests__/extraction-schema.test.ts
import { EXTRACTION_PROMPT, EXTRACTION_SCHEMA } from '@/lib/extraction-schema'

describe('extraction-schema', () => {
  it('should have a non-empty extraction prompt in Spanish', () => {
    expect(EXTRACTION_PROMPT).toContain('clínico')
    expect(EXTRACTION_PROMPT).toContain('Chile')
    expect(EXTRACTION_PROMPT).toContain('antecedentes')
    expect(EXTRACTION_PROMPT.length).toBeGreaterThan(100)
  })

  it('should have patient and clinicalSections as required top-level fields', () => {
    expect(EXTRACTION_SCHEMA.required).toEqual(['patient', 'clinicalSections'])
  })

  it('should have correct patient fields', () => {
    const patientObj = EXTRACTION_SCHEMA.properties.patient as any
    const patientProps = patientObj.properties
    expect(patientProps).toHaveProperty('name')
    expect(patientProps).toHaveProperty('lastName')
    expect(patientProps).toHaveProperty('age')
    expect(patientProps).toHaveProperty('document')
    expect(patientProps).toHaveProperty('docType')
  })

  it('should have correct clinical section fields in Spanish', () => {
    const sectionObj = EXTRACTION_SCHEMA.properties.clinicalSections as any
    const sectionProps = sectionObj.properties
    expect(sectionProps).toHaveProperty('antecedentes')
    expect(sectionProps).toHaveProperty('anamnesis')
    expect(sectionProps).toHaveProperty('examenFisico')
    expect(sectionProps).toHaveProperty('diagnostico')
    expect(sectionProps).toHaveProperty('plan')
  })

  it('should allow null values for all patient fields', () => {
    const patientObj = EXTRACTION_SCHEMA.properties.patient as any
    const patientProps = patientObj.properties
    for (const [, value] of Object.entries(patientProps)) {
      const prop = value as any
      const types = Array.isArray(prop.type) ? prop.type : [prop.type]
      expect(types).toContain('null')
    }
  })

  it('should allow null values for all clinical section fields', () => {
    const sectionObj = EXTRACTION_SCHEMA.properties.clinicalSections as any
    const sectionProps = sectionObj.properties
    for (const [, value] of Object.entries(sectionProps)) {
      const prop = value as any
      const types = Array.isArray(prop.type) ? prop.type : [prop.type]
      expect(types).toContain('null')
    }
  })

  it('should restrict docType to valid enum values', () => {
    const patientObj = EXTRACTION_SCHEMA.properties.patient as any
    const docType = patientObj.properties.docType
    expect(docType.enum).toEqual([0, 1, 3, null])
  })
})
