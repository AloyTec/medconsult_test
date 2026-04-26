'use client'

import type { ExtractedData } from '@/lib/types'

interface Props {
  extractedData: ExtractedData | null
  isExtracting: boolean
}

const SECTION_LABELS: Record<string, string> = {
  antecedentes: 'Antecedentes',
  anamnesis: 'Anamnesis',
  examenFisico: 'Examen Físico',
  diagnostico: 'Diagnóstico',
  plan: 'Plan de Tratamiento',
}

const DOC_TYPE_LABELS: Record<number, string> = {
  0: 'Anónimo',
  1: 'RUT',
  3: 'Pasaporte',
}

export function DataExtraction({ extractedData, isExtracting }: Props) {
  if (!extractedData) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Datos Clínicos Extraídos
        </h3>
        <p className="text-center text-gray-500 py-8">
          {isExtracting
            ? 'Extrayendo datos clínicos...'
            : 'Los datos estructurados aparecerán aquí después del procesamiento'}
        </p>
      </div>
    )
  }

  const { patient, clinicalSections } = extractedData

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          Datos Clínicos Extraídos
        </h3>
        {isExtracting && (
          <span className="text-xs text-blue-600 font-medium">
            Actualizando...
          </span>
        )}
      </div>

      <div className="space-y-4">
        {/* Patient Data */}
        <div className="rounded-lg bg-green-50 p-4 border border-green-200">
          <h4 className="font-semibold text-green-900 mb-2">Datos del Paciente</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-xs text-gray-600">Nombre</p>
              <p className="font-medium text-gray-900">
                {patient.name ?? '—'} {patient.lastName ?? ''}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-600">Edad</p>
              <p className="font-medium text-gray-900">
                {patient.age != null ? `${patient.age} años` : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-600">Documento</p>
              <p className="font-medium text-gray-900">
                {patient.document ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-600">Tipo</p>
              <p className="font-medium text-gray-900">
                {patient.docType != null
                  ? DOC_TYPE_LABELS[patient.docType] ?? String(patient.docType)
                  : '—'}
              </p>
            </div>
          </div>
        </div>

        {/* Clinical Sections */}
        <div className="space-y-3">
          {Object.entries(clinicalSections).map(([key, value]) => (
            <div
              key={key}
              className="rounded-lg bg-gray-50 p-3 border border-gray-200"
            >
              <p className="text-xs font-semibold text-gray-700 mb-1">
                {SECTION_LABELS[key] ?? key}
              </p>
              <p className="text-sm text-gray-900">
                {value ?? <span className="text-gray-400 italic">No mencionado</span>}
              </p>
            </div>
          ))}
        </div>

        {/* JSON Preview */}
        <details className="rounded-lg border border-gray-300">
          <summary className="cursor-pointer p-3 font-semibold text-gray-700 hover:bg-gray-50">
            JSON Preview
          </summary>
          <pre className="overflow-x-auto bg-gray-900 text-gray-100 p-4 text-xs">
            {JSON.stringify(extractedData, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  )
}
