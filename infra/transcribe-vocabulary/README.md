# Diccionario de dictado para AWS Transcribe (custom vocabulary)

Mejora la exactitud del dictado en **Transcribe** sesgándolo hacia términos clínicos y
chilenos (fármacos, abreviaturas, anatomía). Es el equivalente, en el carril AWS, del campo
"Vocabulario del dictado" que OpenAI Realtime trae en la UI.

> ⚠️ **Nunca pongas datos de pacientes (PII/PHI) en el diccionario.** Solo términos genéricos
> del dominio. (Restricción de AWS: *Do not enter confidential information, PII, or PHI into a
> custom vocabulary* — [doc](https://docs.aws.amazon.com/transcribe/latest/dg/custom-vocabulary.html).)

## Artefactos

| Dónde | Para quién | Qué es |
|---|---|---|
| Página **`/diccionario`** en la app | **El doctor** | Diccionario recomendado (visible) + botón "Descargar plantilla CSV" para revisar/extender. |
| `vocabulary-table.txt` (este folder) | Técnico | Los mismos términos ya en el **formato de tabla** que exige Transcribe (lo que se sube a AWS). |

Flujo: el doctor revisa/edita la lista en `/diccionario` → lo pasamos al formato
`vocabulary-table.txt` → se crea el *custom vocabulary* en AWS (una vez) → la app lo usa
automáticamente.

## Formato de la tabla (verificado en la doc de AWS)

Tabla con **4 columnas** `Phrase,SoundsLike,IPA,DisplayAs` (delimitadas por coma o TAB).
`SoundsLike` e `IPA` están deprecadas → se dejan vacías. Reglas de `Phrase`
([doc](https://docs.aws.amazon.com/transcribe/latest/dg/custom-vocabulary-create-table.html)):

- **Sin espacios.** Varias palabras → unidas con guion: `hemorragia-subaracnoidea`.
- **Siglas** → letras separadas por puntos, con punto final: `HTA` → `H.T.A.`, `RUT` → `R.U.T.`.
- **Sin dígitos** en `Phrase` (van deletreados): `DM2` → `D.M.-dos`.
- `DisplayAs` (opcional) = cómo se ve en la transcripción (sí admite espacios y dígitos): `DM2`.

## Crear el vocabulary en AWS (una sola vez)

Debe estar en la **misma región** que el stream (`us-east-1`) y en idioma **es-US**. Usa una
identidad con `transcribe:CreateVocabulary` y lectura S3 sobre el bucket.

```bash
# 1) Sube la tabla a un bucket S3 cualquiera de la cuenta
aws s3 cp vocabulary-table.txt s3://TU-BUCKET/medconsult/vocabulary-table.txt \
  --region us-east-1 --profile cloudforge-medconsult

# 2) Crea el vocabulary (es-US)
aws transcribe create-vocabulary \
  --vocabulary-name medconsult-clinico-es \
  --language-code es-US \
  --vocabulary-file-uri s3://TU-BUCKET/medconsult/vocabulary-table.txt \
  --region us-east-1 --profile cloudforge-medconsult

# 3) Espera a que quede READY (repite hasta ver "READY"; "FAILED" => revisa FailureReason)
aws transcribe get-vocabulary --vocabulary-name medconsult-clinico-es \
  --region us-east-1 --profile cloudforge-medconsult \
  --query "{state:VocabularyState,reason:FailureReason}"
```

## Conectarlo a la app

La app pasa `VocabularyName` automáticamente cuando existe la env var (si no, Transcribe corre
sin diccionario, como hasta ahora). **No requiere cambios de IAM** (el rol ya puede
`StartStreamTranscription`; el vocabulary se referencia por nombre).

- Local: agrega `TRANSCRIBE_VOCABULARY_NAME=medconsult-clinico-es` a `.env.local`.
- Deploy: agrégala en Vercel → Settings → Environment Variables (Production + Preview) y redeploy.

Para actualizar el diccionario luego: `aws transcribe update-vocabulary` (mismo nombre) o crea
uno nuevo y cambia la env var.
