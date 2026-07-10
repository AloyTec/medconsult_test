# Historial de Atenciones — Diseño (2026-07-10)

## Contexto y objetivo

El doctor pidió (WhatsApp, 2026-07-10): *"¿puedo acceder a los registros que se realizaron?"* — quiere revisar atenciones previas para resolver sus reparos sobre las respuestas de la IA. Confirmó que quiere ver **lo que se envió y lo que respondió el sistema**: el transcript, el prompt utilizado, lo que registró la IA (extracción) y los análisis subsecuentes (resumen y test de congruencia).

Hoy el POC no persiste nada (todo muere en el browser) y no tiene auth (cualquiera con la URL usa la app y sus APIs de Bedrock/Transcribe).

## Alcance

**Incluye:** persistir cada atención automáticamente, vista de historial de solo lectura, código de acceso compartido, anonimización de datos de paciente al guardar.

**Excluye (fase futura):** cuentas de usuario individuales, sync en vivo cel↔computador, búsqueda por nombre de paciente (imposible por la anonimización), edición/borrado de registros desde la UI, TTL/retención.

## Decisiones tomadas con el usuario (2026-07-10)

| Decisión | Elección |
|---|---|
| Alcance de fase | Solo historial (sin usuarios ni sync en vivo) |
| Acceso | Código compartido simple (env var + cookie + middleware) |
| Guardado | Automático: cada corrida de extracción crea/actualiza el registro |
| PII | Anonimizar al persistir; las respuestas en vivo mantienen datos reales |
| Storage | DynamoDB `medconsult-poc-atenciones`, cuenta MedConsult (889268462469), us-east-1 |
| Permisos AWS | El usuario ejecuta tabla + política IAM con su propio perfil `cloudforge-medconsult` — **no requiere admin** (validado empíricamente 2026-07-10: `put-role-policy` no-op exitoso, sin SCP) |

## Arquitectura

### Unidad "atención" y captura

- El cliente genera un `atencionId` (**ULID** — helper propio ~30 líneas, sin dependencia nueva; ordena lexicográficamente por tiempo) cada vez que empieza una sesión de dictado nueva. Disparadores exactos: (a) iniciar un dictado con el área de texto **vacía**, (b) reset/limpiar ("Empezar de cero" recarga la página), (c) cargar un transcript de muestra, (d) carga de la página. Editar el textarea manualmente **no** crea atención nueva, y dictar de nuevo sobre un transcript existente **continúa** la misma atención (el buffer del extractor se siembra con el transcript actual).
- Coherencia del dictado en vivo: al detener la grabación se hace **flush** de la extracción pendiente del debounce (2s), para que la última corrida refleje el dictado completo.
- **Visibilidad completa por corrida** (requisito del owner, 2026-07-10): cada corrida registra también el **sistema de dictado (STT) usado** — `openai-realtime`, `transcribe` o `texto` (pegado/muestra) — y cuántos caracteres del dictado procesó (`transcriptChars`).
- El id viaja como **campo opcional y aditivo** en los POST existentes a `/api/extract`, `/api/validate` y `/api/summarize`. Sin el campo, los endpoints se comportan exactamente como hoy (no-breaking; clientes viejos siguen funcionando).
- La persistencia ocurre **server-side dentro de esas rutas** (el cliente no puede "olvidar" guardar):
  - `/api/extract` → crea el registro si no existe y **agrega** la corrida a `runs[]` (fecha, STT, engine, modelo, prompt exacto enviado, caracteres procesados, resultado anonimizado). Actualiza el transcript persistido.
  - `/api/validate` → setea `validation` en el registro (resultado + **prompt/engine/modelo usados**).
  - `/api/summarize` → setea `summary` en el registro (resultado + **prompt/engine/modelo usados**).
- Se persiste el **último** resultado de validación y de resumen (la iteración de prompts completa se conserva solo en las corridas de extracción); la UI los etiqueta "última validación"/"último resumen".
- Prompts persistidos: la **plantilla** que edita el doctor (con el marcador `$CONSULTATION_DATA`, sin los datos inyectados — ya visibles como extracción en el mismo registro). En el carril Bedrock de extracción se guarda el string exacto enviado (instrucciones + forma JSON).
- Se instrumenta `/prompts` (la página raíz `/` redirige ahí; `VoiceRecorder`/`lib/api.ts` son código muerto sin montar y quedan sin instrumentar — decisión documentada).

### Modelo de datos (DynamoDB)

Tabla `medconsult-poc-atenciones`, on-demand (PAY_PER_REQUEST).

- `pk` (S) = `'ATENCION'` — partición única lógica; el volumen del POC (pocas atenciones/día) lo permite de sobra.
- `sk` (S) = `atencionId` (ULID) — al ser time-ordered, un solo `Query` con `ScanIndexForward=false` da la lista newest-first **sin Scan** (invariante del proyecto), y los updates pegan directo por key completa.

Atributos: `createdAt`, `updatedAt`, `pseudonym`, `transcript` (anonimizado, truncado a ~100KB con marcador), `runs[]` (ventana rodante de 20 corridas — guarda del límite de 400KB; cada corrida: `at, stt, engine, model, prompt, transcriptChars, result`), `validation {consistent, observations, prompt, engine, model, at}`, `summary {sections, prompt, engine, model, at}`.

Escrituras sin pisarse (un extract en vuelo + click de Validar es un interleave realista de un solo doctor): `runs` se escribe con lock optimista (condición sobre `updatedAt`, un reintento con estado fresco); `validation`/`summary` se setean con `UpdateItem` sobre atributos independientes (no reemplazan el item completo).

### Anonimización (server-side, solo al persistir)

- Seudónimo determinístico por atención derivado del hash del `atencionId`: ej. `"Paciente A1B2"`. Consistente entre corridas de la misma atención.
- Del JSON extraído se toman `patient.name`, `patient.lastName`, `patient.document` y se reemplazan sus ocurrencias (case-insensitive) en la copia persistida del transcript y de todos los resultados.
- Regex de RUT chileno (`\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]`) como red adicional sobre todo texto persistido.
- **Best-effort declarado:** menciones que la IA no extrajo (variantes del nombre dictadas) pueden quedar. Aceptado explícitamente por el usuario.
- **Riesgo residual documentado:** si se dictan dos pacientes seguidos **sin** "Empezar de cero" ni vaciar el texto, la atención continúa y el scrub solo conoce los identificadores de la extracción vigente — identificadores del paciente anterior pueden quedar en el transcript persistido. Mitigaciones: rotación de atención al dictar con texto vacío + la instrucción existente en la UI de empezar de cero entre consultas.
- Las respuestas de la API al browser mantienen datos reales — el doctor los necesita en vivo para su ficha.

### Código de acceso

- `middleware.ts` en la raíz: protege **todas** las páginas y APIs, excepto `/acceso`, assets estáticos y `_next`. APIs sin cookie → 401; páginas → redirect a `/acceso`. Esto también cierra las APIs hoy abiertas (Bedrock, credenciales Transcribe, SSM).
- Página `/acceso`: input de código → POST → si coincide, setea cookie httpOnly firmada (HMAC-SHA256 vía Web Crypto — compatible con edge runtime), validez 30 días.
- Env vars: `POC_ACCESS_CODE` (el código que se comparte al doctor) y `POC_COOKIE_SECRET` (firma), en Vercel y `.env.local`.

### UI — página `/historial`

- **Lista** newest-first: fecha/hora local, seudónimo, snippet del diagnóstico, nº de corridas, ✓ validación, ✓ resumen. `Limit` 50 con cursor opt-in (`nextToken`) si crece.
- **Detalle**: transcript completo, cada corrida (fecha · **STT usado** · engine/modelo · caracteres procesados; prompt colapsable + resultado formateado igual que `DataExtraction`), última validación de congruencia y último resumen (cada uno con su prompt colapsable y engine/modelo).
- Solo lectura. `NavLink` nuevo en la navegación.
- Endpoints: `GET /api/atenciones` (lista, proyección liviana) y `GET /api/atenciones/[id]` (registro completo).

## Manejo de errores

- Persistir es **best-effort**: si DynamoDB falla, se loguea diagnóstico PII-safe (ids y tamaños, nunca contenido), la respuesta clínica sale igual con el **header** aditivo `x-atencion-saved: false` (header y no campo del body, para no ensuciar el JSON crudo que el doctor ve en la UI), y la UI muestra un aviso discreto ("no se guardó en historial") — también para las corridas del dictado en vivo (callback de estado de guardado en el servicio de extracción). El flujo del doctor nunca se bloquea por el historial.
- Guardas de tamaño: transcript truncado, `runs` con cap; si un item roza 400KB se loguea y se degrada (corrida sin prompt completo) antes de fallar el write.

## Testing

- Jest, env `node` (docblock), clientes AWS mockeados — mismo patrón que `__tests__/bedrock.test.ts`:
  - Anonimizador: variantes de nombre, formatos de RUT (`12.345.678-9`, `12345678-9`), texto sin PII intacto, determinismo del seudónimo.
  - Repositorio: construcción de keys, append de runs con cap, truncado de transcript, proyección de lista.
  - Middleware: cookie válida/ inválida/ausente; rutas exentas.
  - Rutas: `extract` con y sin `atencionId` (no-breaking), `saved:false` cuando DDB falla.
- `tsc` y lint limpios antes del PR. E2E manual en preview deploy.

## Infra (la ejecuta el usuario con `cloudforge-medconsult`)

1. `aws dynamodb create-table` — `medconsult-poc-atenciones`, PK `pk`/SK `sk`, PAY_PER_REQUEST.
2. `aws iam put-role-policy` — política inline nueva `medconsult-poc-atenciones-ddb` en el rol `medconsult-poc-vercel`: `dynamodb:PutItem, UpdateItem, GetItem, Query` **solo** sobre el ARN de esa tabla (least-privilege; no se tocan las 2 políticas existentes).
3. Env vars en Vercel: `POC_ACCESS_CODE`, `POC_COOKIE_SECRET` (+ `.env.local` local).

Comandos exactos se preparan en el plan de implementación.

## Rollout

Branch → PR (una sola concern: historial + acceso) → merge del owner → deploy prod autorizado por el owner → validación e2e en prod → compartir código de acceso y noticia al doctor por WhatsApp.
