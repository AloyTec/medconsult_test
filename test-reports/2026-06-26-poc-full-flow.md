# Reporte de testeo — POC web (flujo completo)

- **Fecha:** 2026-06-26
- **Entorno:** https://medconsulttest.vercel.app (producción, rama `poc/ssm-prompts` → `main`)
- **Método:** automatización de navegador (extensión de Claude en Chrome) sobre el deploy en vivo +
  smoke de API por `curl`.
- **Alcance:** editor de prompts (extracción / validación / resumen) en los carriles OpenAI y
  Bedrock, selector de modelo, y todos los flujos de UI.
- **Datos:** sintéticos (caso ficticio "Rosa Muñoz"). Sin PHI.
- **Resultado global:** ✅ **todo pasó. 0 bugs.**

## Motor × Acción (vía UI)

| Acción | OpenAI | Bedrock | Estado |
|---|---|---|---|
| Extraer | gpt-4o-mini | Haiku 4.5 (1864 ms) · Sonnet 4.6 (2410 ms) | ✅ |
| Validar | gpt-4o-mini → *Inconsistente* | Opus 4.6 → *Inconsistente* | ✅ |
| Resumir | gpt-4o-mini (5 secciones) | Haiku 4.5 (5 secciones) | ✅ |

- Los 3 modelos Bedrock (Haiku/Sonnet/Opus) además verificados por **API** para las 3 acciones → 200.
- El **validador** marcó correctamente *Inconsistente* con el dictado de alergia-penicilina +
  amoxicilina (control de seguridad clínica), tanto en OpenAI como en Bedrock Opus.
- **Selector de modelo Bedrock:** Haiku → Sonnet → Opus → Haiku, cada uno enrutó bien (latencias
  distintas confirman el cambio).

## Flujos de UI

| Caso | Estado |
|---|---|
| Tabs Extracción/Validación/Resumen + botón de acción contextual | ✅ |
| Pipeline encadenado (Validar/Resumir sobre datos extraídos) | ✅ |
| Ver versiones (historial SSM, más reciente primero, click carga) | ✅ |
| Restaurar original (resetea + quita "sin guardar") | ✅ |
| Guard: prompt < 20 chars → bloqueado | ✅ |
| Guard: falta `$CONSULTATION_DATA` (Validación/Resumen) → bloqueado | ✅ |
| Toggle STT OpenAI ↔ AWS Transcribe (campo vocab / link diccionario) | ✅ |
| Página `/diccionario` (4 grupos + CSV + aviso PII) | ✅ |
| Extraer sin transcripción → error controlado | ✅ |
| Ejemplo "Control general" llena la transcripción | ✅ |
| Recarga de `/prompts` → estado limpio (motor vuelve a OpenAI) | ✅ |

## No testeado por navegador (anotado, no es falla)
- **Dictado por voz real (STT):** requiere audio de micrófono que la automatización no puede inyectar.
  Toggle/UI verificado; el streaming en sí queda para prueba manual.
- **"Empezar de cero":** usa `window.confirm()`, que congela la automatización (regla de seguridad).
  No se clickeó a propósito; es un simple reload.
- **Descarga CSV:** no se disparó para evitar diálogos del navegador; el botón está presente.

## Hallazgos
- **Bugs:** ninguno.
- **Fix desplegado durante el testeo:** error transitorio "La respuesta de Bedrock no es JSON válido"
  en Validar/Resumir con modelos verbosos (Sonnet/Opus) → era truncamiento por `max_tokens`. Se subió
  validate 300→1024 y summarize 800→2048 + error explícito si `stop_reason=max_tokens`
  (commit `3f8f8e3`, PR #7). Re-verificado: Sonnet ×3 validate → 200/200/200.
- **Observación (no bug):** la extracción a veces deja el RUT sin normalizar / Tipo "Anónimo" — es
  varianza del modelo/prompt (el prompt es la palanca), no un defecto del contrato (200 + forma OK).

## Pendientes operativos (fuera del alcance funcional)
- **Deployment Protection** en Vercel: OFF → el deploy es público y las APIs no tienen auth. Activar
  antes de difundir el link.
- **Custom vocabulary de Transcribe:** aún no creado; setear `TRANSCRIBE_VOCABULARY_NAME` después.
