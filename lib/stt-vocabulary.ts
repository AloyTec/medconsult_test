// Sesgo de vocabulario para el dictado (STT). Es editable desde la UI igual que el
// prompt de extracción: la idea es iterar hasta que el motor "oiga" bien la jerga
// clínica chilena (fármacos, abreviaturas, anatomía).
//
// - OpenAI Realtime: este texto se manda como `prompt` en input_audio_transcription.
// - AWS Transcribe: NO usa este texto; usa una custom vocabulary (VocabularyName) creada
//   aparte (ver infra/transcribe-vocabulary/). Por eso el campo se muestra solo con OpenAI.
export const DEFAULT_STT_PROMPT = `Dictado clínico en español de Chile.
Vocabulario frecuente:
- Fármacos: omeprazol, paracetamol, ibuprofeno, amoxicilina, metformina, losartán, atorvastatina, enalapril, aspirina, ranitidina, furosemida.
- Abreviaturas: HTA, DM2, EPOC, IAM, ICC, ACV, ERC, NAC, TVP, RUT, CSV, PA, FC.
- Anatomía: epigastrio, hipocondrio, mesogastrio, tórax, abdomen.
- Términos: anamnesis, antecedentes, cefalea, disnea, náuseas, vómitos, palpación, peritoneales.
Transcribe el RUT como dígitos. Mantén la ortografía médica correcta.`

// Diccionario recomendado (vista doctor en /diccionario + descarga CSV + base de la
// custom vocabulary de Transcribe en infra/transcribe-vocabulary/vocabulary-table.txt).
// `displayAs` solo cuando difiere de la palabra dictada (p. ej. siglas).
export interface VocabTerm {
  term: string
  displayAs?: string
}
export interface VocabGroup {
  category: string
  hint: string
  terms: VocabTerm[]
}

export const RECOMMENDED_VOCABULARY: VocabGroup[] = [
  {
    category: 'Fármacos',
    hint: 'Nombres de medicamentos frecuentes',
    terms: [
      { term: 'omeprazol' },
      { term: 'paracetamol' },
      { term: 'ibuprofeno' },
      { term: 'amoxicilina' },
      { term: 'metformina' },
      { term: 'losartán' },
      { term: 'atorvastatina' },
      { term: 'enalapril' },
      { term: 'ranitidina' },
      { term: 'furosemida' },
    ],
  },
  {
    category: 'Abreviaturas',
    hint: 'Siglas clínicas (cómo deben aparecer escritas)',
    terms: [
      { term: 'hipertensión arterial', displayAs: 'HTA' },
      { term: 'diabetes mellitus tipo 2', displayAs: 'DM2' },
      { term: 'EPOC', displayAs: 'EPOC' },
      { term: 'infarto agudo de miocardio', displayAs: 'IAM' },
      { term: 'insuficiencia cardíaca', displayAs: 'ICC' },
      { term: 'accidente cerebrovascular', displayAs: 'ACV' },
      { term: 'enfermedad renal crónica', displayAs: 'ERC' },
      { term: 'neumonía adquirida en la comunidad', displayAs: 'NAC' },
      { term: 'trombosis venosa profunda', displayAs: 'TVP' },
      { term: 'RUT', displayAs: 'RUT' },
    ],
  },
  {
    category: 'Anatomía',
    hint: 'Regiones y referencias anatómicas',
    terms: [
      { term: 'epigastrio' },
      { term: 'hipocondrio' },
      { term: 'mesogastrio' },
      { term: 'tórax' },
      { term: 'abdomen' },
    ],
  },
  {
    category: 'Términos clínicos',
    hint: 'Palabras del examen y la historia',
    terms: [
      { term: 'anamnesis' },
      { term: 'antecedentes' },
      { term: 'cefalea' },
      { term: 'disnea' },
      { term: 'náuseas' },
      { term: 'vómitos' },
      { term: 'fotofobia' },
      { term: 'palpación' },
      { term: 'peritoneales' },
      { term: 'hemorragia subaracnoidea' },
    ],
  },
]
