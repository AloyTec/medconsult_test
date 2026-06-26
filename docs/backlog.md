# Backlog — POC web (ideas / spikes pendientes)

Cosas identificadas pero NO urgentes para el POC. Revisar antes de producción.

## SPIKE: cambiar el modo de transcripción de voz a "transcripción-sola" (OpenAI)

**Estado:** pendiente · **Prioridad:** media (pre-producción) · **Tipo:** optimización de costo

**Qué pasa hoy.** El dictado OpenAI abre una **sesión Realtime conversacional completa**
(`app/api/realtime/sdp/route.ts`): `model: gpt-realtime-2`, `output_modalities: ['text']`, con
`input_audio_transcription.model: gpt-4o-mini-transcribe`. La app **solo consume los eventos de
transcripción** — nunca dispara `response.create` —, pero igual paga el audio a la tarifa del motor
conversacional `gpt-realtime-2` (**$32/1M tokens de audio ≈ $0,019/min ≈ ~$0,08 por dictado de 4 min**).

**Propuesta.** Usar una **sesión de transcripción-sola** de OpenAI (`transcription_sessions` /
`type: transcription`, transporte WebSocket en vez del `/v1/realtime/calls` WebRTC). No levanta el
modelo conversacional → se factura **solo** el modelo de transcripción (gpt-4o-mini-transcribe a su
tarifa de audio, ~$0,003–$0,006/min). Mismo streaming en vivo, mismo llenado de campos.

**Impacto estimado.**

| | Por dictado (4 min) | A 3.000 consultas/mes |
|---|---|---|
| Hoy (`gpt-realtime-2` full) | ~$0,08 | ~$240/mes |
| Transcripción-sola (gpt-4o-mini-transcribe) | ~$0,02–0,03 | ~$72–90/mes |
| **Ahorro** | ~3–4× | **~$150–170/mes** |

**Objetivo del spike.**
1. Validar la **facturación real** de una sesión transcripción-sola con una corrida medida (no asumir;
   la tarifa de gpt-4o-mini-transcribe en streaming hay que confirmarla).
2. Probar `lib/openai-realtime.ts` + el proxy con el transporte WebSocket de transcripción.
3. Confirmar que las latencias y los deltas de transcripción (llenado en vivo) se mantienen.

**Riesgos / matices.**
- Refactor acotado pero real (otro endpoint/transporte).
- **Diverge del Flutter** que hoy espejamos (Flutter usa la sesión completa) → decidir si la app real
  también migra.
- Alternativa más barata aún (gpt-4o-mini-transcribe **por lotes**, ~$0,003/min) **pierde el tiempo
  real** → no sirve para la UX en vivo; solo para un eventual modo "grabar y procesar".

**No bloquea el POC** (son centavos por dictado). El driver es producción a escala.
