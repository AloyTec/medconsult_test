// lib/extraction-schema.ts

/**
 * Clinical data extraction schema and prompt — matches Flutter implementation exactly.
 * Used with OpenAI Responses API (POST /v1/responses) for structured output.
 */

export const EXTRACTION_PROMPT = `Eres un asistente clínico especializado en documentación médica en Chile.

A partir de la transcripción del médico:
- Extrae información estructurada del paciente.
- Extrae información clínica SOLO si el médico la menciona explícitamente.
- No inventes diagnósticos, exámenes ni planes.
- Si una sección no ha sido mencionada, devuélvela como null.
- Si el médico habla en forma narrativa, resume clínicamente en lenguaje médico.

Documento del paciente:
- Extrae \`document\` y \`docType\` si el médico lo menciona.
- \`docType\`: 0=anónimo (sin documento o se autogenera), 1=RUT, 3=pasaporte.
- \`document\` debe venir SIN puntos, SIN guiones y SIN espacios.
- Para RUT: retorna solo dígitos (y letra K si corresponde). Si se menciona con puntos/guión, normalízalo.
- Para pasaporte: puede contener letras y números; normaliza a mayúsculas y sin separadores.
- Si no se menciona documento, devuelve \`document: null\` y \`docType: null\`.

Secciones clínicas:
- antecedentes: enfermedades previas, cirugías, hábitos.
- anamnesis: motivo de consulta e historia actual.
- examenFisico: hallazgos del examen físico.
- diagnostico: diagnósticos o hipótesis clínicas.
- plan: indicaciones, exámenes, tratamiento, seguimiento.

Corrige errores fonéticos comunes de transcripción.
Convierte números hablados en números reales.

Devuelve SOLO JSON válido.`

export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    patient: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: ['string', 'null'] },
        lastName: { type: ['string', 'null'] },
        age: { type: ['number', 'null'] },
        document: { type: ['string', 'null'] },
        docType: { type: ['number', 'null'], enum: [0, 1, 3, null] },
      },
      required: ['name', 'lastName', 'age', 'document', 'docType'],
    },
    clinicalSections: {
      type: 'object',
      additionalProperties: false,
      properties: {
        antecedentes: { type: ['string', 'null'] },
        anamnesis: { type: ['string', 'null'] },
        examenFisico: { type: ['string', 'null'] },
        diagnostico: { type: ['string', 'null'] },
        plan: { type: ['string', 'null'] },
      },
      required: ['antecedentes', 'anamnesis', 'examenFisico', 'diagnostico', 'plan'],
    },
  },
  required: ['patient', 'clinicalSections'],
} as const
