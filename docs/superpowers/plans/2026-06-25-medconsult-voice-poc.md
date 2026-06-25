# MedConsult Voice POC — Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` (inline) or `superpowers:subagent-driven-development` to implement task-by-task. Steps use `- [ ]` checkboxes. Browser/mic/AWS steps that can't run headlessly are marked **🔬 manual checkpoint** — verify with the owner before checking off.

**Goal:** A doctor-facing web POC that (a) lets the owner edit the AI prompts and see their effect live, and (b) reproduces Flutter's real-time dictation → live field-filling, across three STT engines (OpenAI, Amazon Transcribe, Nova Sonic), to decide the migration on accuracy/quality/cost.

**Architecture:** Next.js (App Router) on Vercel. **All provider secrets stay server-side**; the browser only ever gets short-lived tokens/creds. STT is decoupled from extraction: any streaming transcript feeds a 2s-debounced extraction call (`/api/extract`) with the **editable** prompt + JSON schema — exactly the Flutter mechanism (`clinical_recording_cubit.dart:357-360`).

**Tech Stack:** Next.js 16 / React 19 / TS / Tailwind v4. OpenAI Realtime (WebRTC) + Responses API. `@aws-sdk/client-transcribe-streaming`, `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-sts`. Design tokens mirror `medconsult_app/lib/core/theme.dart`.

**Hard rules (every phase):** synthetic/de-identified data only (never real PHI); no permanent key in the browser; redeploy to Vercel after each phase; PR-tracked (`AAloyTec/medconsult_test#1`).

---

## Phase 0 — Foundation ✅ DONE (PR #1)

- [x] `/api/extract` accepts an editable `prompt` (default = canonical), key server-side
- [x] `/prompts` playground: edit prompt → run on synthetic transcript → structured fields + latency
- [x] Flutter design system ported (teal `#07394F`, Roboto, Tailwind v4 `@theme` tokens, nav/header)
- [x] Fixed home setup note (`NEXT_PUBLIC_OPENAI_API_KEY` → server-side `OPENAI_API_KEY`)
- [x] `tsc` + `next build` clean
- [x] Linked to Vercel (`arcturus91s-projects/medconsult_test`), `OPENAI_API_KEY` in Production, deployed
- [ ] **🔬 manual checkpoint:** owner opens the deployed `/prompts`, edits a prompt, confirms fields change

**🔒 Security checkpoint (do before sharing the URL):** set an OpenAI **spending cap** on the deployed key (it's reachable via `/api/extract` on a public URL); rotate to a **fresh** key if the `.env` one was ever exposed; enable Vercel Deployment Protection if the plan allows.

---

## Phase 1 — Real-time audio, faithful to Flutter (OpenAI lane)

**Goal:** speak → live transcript → fields fill in as you talk, identical to Flutter, with the key server-side. This is the demo "wow".

**Files:**
- Modify: `app/api/realtime-token/route.ts` (current model + transcription config)
- Modify: `lib/openai-realtime.ts` (WebRTC client using the ephemeral token)
- Modify: `lib/hooks/useVoiceRecording.ts` (buffer + 2s debounce → `/api/extract` with the live prompt)
- Modify: `app/prompts/page.tsx` (add a "Dictar" mode that streams into the same editor)

### Task 1.1: Match the realtime session to Flutter

- [ ] **Step 1:** In `app/api/realtime-token/route.ts`, replace the stale body with Flutter's session config:

```ts
const tokenRequestBody = {
  model: 'gpt-realtime-2',                       // matches medconsult_app (commit "new model")
  output_modalities: ['text'],                   // transcriber only, no voice out
  audio: {
    input: {
      transcription: { language: 'es', model: 'gpt-4o-mini-transcribe' },
    },
  },
}
```

- [ ] **Step 2:** Confirm the route still returns `{ token, expires_at }` from `client_secret`.
- [ ] **Step 3:** `npx tsc --noEmit` → expect clean.
- [ ] **Step 4:** Commit: `feat(audio): realtime-token uses gpt-realtime-2 + es transcription`

### Task 1.2: Browser WebRTC client (ephemeral token, no key)

- [ ] **Step 1:** In `lib/openai-realtime.ts`, implement a class that: `POST /api/realtime-token` → gets the ephemeral token → opens an `RTCPeerConnection`, adds the mic track, creates the `oai-events` DataChannel, posts the SDP offer to `https://api.openai.com/v1/realtime/calls` **with the ephemeral token** (not the real key), sets the answer. Emits transcript text only on `conversation.item.input_audio_transcription.completed` (mirror `clinical_recording_cubit.dart:341-362`).
- [ ] **Step 2:** Expose `onTranscript(cb)` and `stop()`.
- [ ] **Step 3:** `npx tsc --noEmit` → clean.
- [ ] **Step 4:** Commit: `feat(audio): WebRTC realtime client via ephemeral token`

### Task 1.3: Debounced live extraction (the field-filling)

- [ ] **Step 1:** In `lib/hooks/useVoiceRecording.ts`: accumulate completed transcript chunks into a buffer; on each chunk, reset a **2000ms** timer; on fire, `POST /api/extract` with `{ transcript: buffer, prompt }` and apply the result to state. Add a `jobId` guard so only the latest extraction wins (mirror Flutter `:233,:262`).
- [ ] **Step 2:** The hook accepts the current `prompt` so edits during dictation take effect on the next debounce.
- [ ] **Step 3:** `npx tsc --noEmit` → clean.
- [ ] **Step 4:** Commit: `feat(audio): 2s-debounced live extraction wired to editable prompt`

### Task 1.4: Wire dictation into the editor UI

- [ ] **Step 1:** In `app/prompts/page.tsx`, add a "Dictar" button next to "Extraer" that starts/stops `useVoiceRecording`; while recording, show a live transcript and let the fields fill via the debounced extraction. Keep the text path working.
- [ ] **Step 2:** Reduced-motion + disabled/recording states, mic permission error message (`role="alert"`).
- [ ] **Step 3:** `npx tsc --noEmit` && `npm run build` → clean.
- [ ] **Step 4:** Commit + push to `poc/prompt-editor`; redeploy `vercel --prod --yes`.
- [ ] **🔬 manual checkpoint (owner, mic):** speak a synthetic dictation → transcript appears live → fields fill within ~2s of pauses → edit the prompt mid-session → next pause reflects the change. Confirms Phase 1 = Flutter parity.

---

## Phase 2 — All-in-AWS STT (P2)

**Goal:** the same live experience, but STT inside AWS (one BAA). Transcribe first (verified pricing), then Nova Sonic (cheaper-if-it-holds, spike).

**Files:**
- Create: `app/api/aws-stt-creds/route.ts` (STS temp creds — Cognito-free)
- Create: `lib/transcribe-streaming.ts` (browser Transcribe client)
- Create: `infra/transcribe-role.md` (the scoped IAM role; CLI/CDK, no console)
- Modify: `app/api/extract/route.ts` (optional Bedrock extraction toggle)

### Task 2.1: Scoped IAM role + STS creds route (no Cognito)

- [ ] **Step 1:** Create an IAM role `medconsult-poc-transcribe` trusted by the deploy's principal, policy = `transcribe:StartStreamTranscription*` only. Document the exact `aws iam` CLI in `infra/transcribe-role.md` (no console).
- [ ] **Step 2:** `app/api/aws-stt-creds/route.ts`: server calls STS `AssumeRole` (server holds AWS creds via Vercel env `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` or Vercel-OIDC), returns 15-min `{ accessKeyId, secretAccessKey, sessionToken, region }` to the browser. **Never returns the long-lived key.**
- [ ] **Step 3:** `npx tsc --noEmit` → clean.
- [ ] **Step 4:** Commit: `feat(aws): STS temp-creds route for browser Transcribe (no Cognito)`
- [ ] **🔬 checkpoint:** `curl` the route → returns scoped temp creds; verify they can only call Transcribe.

### Task 2.2: Browser Transcribe streaming → same extraction loop

- [ ] **Step 1:** `npm i @aws-sdk/client-transcribe-streaming`.
- [ ] **Step 2:** `lib/transcribe-streaming.ts`: get temp creds from `/api/aws-stt-creds`, open `StartStreamTranscriptionCommand` (es-US, mic PCM), emit partial+final transcripts; feed the SAME `useVoiceRecording` buffer/debounce.
- [ ] **Step 3:** Add an STT-engine switch in the UI (OpenAI | Transcribe).
- [ ] **Step 4:** `tsc` + `build` → clean. Commit + redeploy.
- [ ] **🔬 manual checkpoint (mic):** Transcribe lane produces a live es-US transcript and fills fields; compare feel vs OpenAI lane.

### Task 2.3: Bedrock Claude Haiku extraction (target, server-side)

- [ ] **Step 1:** `npm i @aws-sdk/client-bedrock-runtime`. Add a server path in `/api/extract` that, when `engine=bedrock`, calls Claude Haiku with forced-JSON (tool use) using the SAME prompt + schema (see `cloudforge-bedrock-pattern`). Keep OpenAI path as default.
- [ ] **Step 2:** `tsc` + `build`. Commit + redeploy.
- [ ] **🔬 checkpoint:** Bedrock extraction returns schema-valid JSON parity with the OpenAI path on the same transcript.

### Task 2.4: Nova Sonic lane (SPIKE — highest risk)

- [ ] **Step 1:** Investigate `InvokeModelWithBidirectionalStream` for Nova Sonic ASR from a browser/server-proxy; confirm the audio→token billing in a real es-US session (the only `≈estimated` cost number — see `medconsult-aws-migration`).
- [ ] **Step 2:** Implement a server-side bidirectional proxy (Vercel serverless likely insufficient → note host requirement) OR temp-creds direct if supported.
- [ ] **Step 3:** Feed transcript into the same extraction loop. Add Nova to the engine switch.
- [ ] **🔬 checkpoint:** Nova produces a usable es-US transcript; capture its real $/min.

---

## Phase 3 — A/B: accuracy, quality, cost (P3)

**Goal:** the go/no-go evidence for the STT migration.

**Files:**
- Create: `app/compare/page.tsx` (side-by-side lanes)
- Create: `lib/wer.ts` (word error rate vs a reference transcript)

### Task 3.1: Same-audio, three-lane comparison

- [ ] **Step 1:** `app/compare/page.tsx`: run one dictation, fan out to OpenAI / Transcribe / Nova; show each transcript + extracted JSON + latency side by side.
- [ ] **Step 2:** `lib/wer.ts`: compute WER against a pasted reference transcript (Levenshtein on tokens). Show WER per engine.
- [ ] **Step 3:** `tsc` + `build`. Commit + redeploy.
- [ ] **🔬 manual checkpoint (mic):** read a scripted clinical paragraph → table of WER + field-fill quality + latency + (from memory) cost → decide Nova vs Transcribe vs stay-OpenAI.

### Task 3.2: Record the decision

- [ ] **Step 1:** Write the result into `docs/STT-DECISION.md` and update the migration memory (target engine + numbers).
- [ ] **Step 2:** Commit.

---

## Cross-cutting checklist (don't miss)

- [ ] Each phase: redeploy to Vercel + owner verifies the live URL.
- [ ] OpenAI key: spending cap set; fresh key if ever exposed.
- [ ] Vercel: Deployment Protection considered before sharing with doctors.
- [ ] AWS creds for the server: least-privilege; rotate after the POC.
- [ ] Only synthetic/de-identified dictation anywhere in this repo.
- [ ] Keep PR #1 as the running record (push small, descriptive commits).
