# Procedimiento de testeo — POC web (editor de prompts clínicos)

Checklist manual/automatizable para validar la web POC (`medconsulttest.vercel.app`) de punta a
punta antes de compartirla o tras cambios. Pensado para correrse con la **extensión de Claude en
Chrome** (o a mano). Complementa el smoke de API por `curl`.

## Prerrequisitos
- Deploy accesible (`/prompts` responde 200).
- Para los carriles Bedrock: el rol OIDC debe permitir los 3 modelos (Haiku 4.5 / Sonnet 4.6 /
  Opus 4.6). Para "Ver versiones": `ssm:GetParameterHistory`. Ver `infra/vercel-aws-oidc.md`.
- **Datos sintéticos siempre** — nunca datos de pacientes reales.

## Dictado de prueba que dispara INCONSISTENCIA (para validar el validador)
> Paciente Rosa Muñoz, 60 años, RUT 9.876.543-2. Antecedentes: hipertensión arterial y **alergia
> conocida a la penicilina**. Consulta por dolor de garganta y fiebre de dos días. Al examen físico,
> faringe enrojecida con placas de pus en las amígdalas. Diagnóstico: amigdalitis aguda bacteriana.
> Plan: **amoxicilina** 875 mg cada doce horas por siete días, paracetamol, control en una semana.

Dispara inconsistencia porque el plan receta amoxicilina (una penicilina) con alergia documentada a
penicilina. Caso #1 de la regla del prompt de validación.

## Matriz a cubrir (Motor × Acción)
Para cada acción, probar al menos OpenAI y Bedrock; en Bedrock rotar modelo.

| Acción | OpenAI | Bedrock |
|---|---|---|
| Extraer  | gpt-4o-mini (default) | Haiku 4.5 · Sonnet 4.6 · Opus 4.6 |
| Validar  | gpt-4o-mini | Haiku/Sonnet/Opus |
| Resumir  | gpt-4o-mini | Haiku/Sonnet/Opus |

**Pass:** cada combinación responde 200, llena su panel (datos / veredicto / 5 secciones) y muestra
latencia "Listo · N ms". El validador marca **Inconsistente** con el dictado de arriba.

## Flujos de UI a verificar
1. **Tabs** Extracción/Validación/Resumen cambian el editor y el botón de acción (Extraer/Validar/Resumir).
2. **Pipeline encadenado:** Validar/Resumir quedan deshabilitados hasta que Extraer produce datos.
3. **Selector de modelo Bedrock** cambia el modelo usado (verificar por latencia distinta).
4. **Ver versiones** lista versiones SSM (más reciente primero); click carga una al editor.
5. **Restaurar original** vuelve el prompt al default y quita el badge "sin guardar".
6. **Guardar — guards:** (a) prompt < 20 chars → bloqueado; (b) en Validación/Resumen sin
   `$CONSULTATION_DATA` → bloqueado. Ninguno debe escribir en SSM.
7. **Toggle STT:** OpenAI Realtime muestra el campo "Vocabulario del dictado"; AWS Transcribe muestra
   la nota + link "Ver diccionario recomendado".
8. **Página `/diccionario`:** 4 grupos (Fármacos/Abreviaturas/Anatomía/Términos), aviso PII, botón
   "Descargar plantilla CSV".
9. **Edge:** Extraer sin transcripción → error "Primero pega o elige…".
10. **Ejemplos** ("Control general" / "Urgencia") llenan la transcripción.
11. **Recarga** de `/prompts` deja estado limpio (motor vuelve a OpenAI, sin datos).

## No automatizable por navegador (verificar a mano si aplica)
- **Dictado por voz real (STT):** requiere audio de micrófono; la automatización no puede inyectarlo.
  Verificar el toggle/UI; el streaming en sí se valida manualmente o por API.
- **"Empezar de cero":** usa `window.confirm()`, que **congela** la automatización del navegador. NO
  clickear en runs automatizados; probar a mano (es un reload).
- **Descarga CSV:** puede abrir un diálogo de guardado; verificar presencia del botón.

## Smoke de API (rápido, sin navegador)
```bash
BASE=https://medconsulttest.vercel.app
# Bedrock (Sonnet) extracción/validación/resumen — repetir con engine=openai
curl -s -X POST $BASE/api/extract   -H 'content-type: application/json' -d '{"transcript":"...","engine":"bedrock","model":"us.anthropic.claude-sonnet-4-6"}'
curl -s -X POST $BASE/api/validate  -H 'content-type: application/json' -d '{"data":{...},"engine":"bedrock","model":"us.anthropic.claude-sonnet-4-6"}'
curl -s -X POST $BASE/api/summarize -H 'content-type: application/json' -d '{"data":{...},"engine":"bedrock","model":"us.anthropic.claude-sonnet-4-6"}'
curl -s "$BASE/api/prompts/history?key=extraction"   # historial SSM
```

## Criterio de cierre
Todas las combinaciones de la matriz + los flujos de UI en verde, sin errores no controlados. Anotar
modelo/latencia y cualquier varianza de calidad (p. ej. normalización de RUT) como observación, no
como bug si el contrato (200 + forma) se cumple.
