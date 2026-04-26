// lib/types.ts

export interface PatientData {
  name: string | null
  lastName: string | null
  age: number | null
  document: string | null // Normalized: no dots, no dashes
  docType: number | null // 0=anonymous, 1=RUT, 3=passport
}

export interface ClinicalSections {
  antecedentes: string | null // Medical history
  anamnesis: string | null // Consultation reason / current illness
  examenFisico: string | null // Physical examination
  diagnostico: string | null // Diagnosis
  plan: string | null // Treatment plan
}

export interface ExtractedData {
  patient: PatientData
  clinicalSections: ClinicalSections
}

export interface RecordingState {
  isRecording: boolean
  isPaused: boolean
  liveTranscript: string
  fullTranscript: string
  extractedData: ExtractedData | null
  error: string | null
  isProcessing: boolean
  isExtracting: boolean
  elapsedSeconds: number
}
