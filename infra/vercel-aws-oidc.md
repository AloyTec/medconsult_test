# Vercel → AWS via OIDC (no static keys) — admin runbook

**Goal:** let the deployed POC's functions call **Bedrock** (extraction) and **SSM** (prompt
persistence) **without any long-lived AWS access key**. Vercel hands each function a short-lived
OIDC token; AWS trusts it and returns ~1h temp creds for a **tightly-scoped role**.

**Why an admin runs this:** creating an IAM OIDC provider + role is IAM-write — a dev SSO role
can't do it. Run the steps below with an **IAM-admin** identity (or port to Pulumi).

**Scope (blast radius):** the role can ONLY `bedrock:InvokeModel` (Claude Haiku 4.5 / Sonnet 4.6 /
Opus 4.6) + `ssm:Get/PutParameter` on `/medconsult/poc/prompts/*`. **No PHI, no other resources.**
Code already wired (see Step 4).

Verified against: <https://vercel.com/docs/oidc/aws>. Account `889268462469`, region `us-east-1`.

---

## 0. Values to fill
- `TEAM_SLUG` — the path in your Vercel team URL (here: `arcturus91s-projects`).
- `PROJECT` — `medconsult_test`.
- `ACCOUNT_ID` — `889268462469`.

## 1. Create the OIDC identity provider (AWS Console — easiest, auto-thumbprint)
IAM → **Identity providers** → **Add provider** → **OpenID Connect**:
- **Provider URL:** `https://oidc.vercel.com/arcturus91s-projects`
- **Audience:** `https://vercel.com/arcturus91s-projects`
→ **Add provider**.

## 2. Create the scoped IAM role
`trust-policy.json` (pins to *this* project, production + preview):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::889268462469:oidc-provider/oidc.vercel.com/arcturus91s-projects" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "oidc.vercel.com/arcturus91s-projects:aud": "https://vercel.com/arcturus91s-projects" },
      "StringLike": { "oidc.vercel.com/arcturus91s-projects:sub": [
        "owner:arcturus91s-projects:project:medconsult_test:environment:production",
        "owner:arcturus91s-projects:project:medconsult_test:environment:preview"
      ] }
    }
  }]
}
```
`permissions-policy.json` (least privilege — Bedrock Claude (Haiku/Sonnet/Opus) + the POC SSM namespace only):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockInvokeClaude",
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": [
        "arn:aws:bedrock:us-east-1:889268462469:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:us-east-1:889268462469:inference-profile/us.anthropic.claude-sonnet-4-6",
        "arn:aws:bedrock:us-east-1:889268462469:inference-profile/us.anthropic.claude-opus-4-6-v1",
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6",
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-opus-4-6-v1"
      ]
    },
    {
      "Sid": "PocPromptsSsm",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:PutParameter"],
      "Resource": "arn:aws:ssm:us-east-1:889268462469:parameter/medconsult/poc/prompts/*"
    },
    {
      "Sid": "TranscribeStreaming",
      "Effect": "Allow",
      "Action": ["transcribe:StartStreamTranscription", "transcribe:StartStreamTranscriptionWebSocket"],
      "Resource": "*"
    }
  ]
}
```
> Note: `transcribe:StartStreamTranscription*` doesn't support resource-level scoping, so `Resource: "*"` is required — keep the role otherwise minimal.
Create + attach (IAM-admin profile):
```bash
aws iam create-role --role-name medconsult-poc-vercel \
  --assume-role-policy-document file://trust-policy.json
aws iam put-role-policy --role-name medconsult-poc-vercel \
  --policy-name medconsult-poc-bedrock-ssm \
  --policy-document file://permissions-policy.json
aws iam get-role --role-name medconsult-poc-vercel --query Role.Arn --output text   # copy this ARN
```
> **Updating an existing role** (e.g. to add Sonnet 4.6 / Opus 4.6): the role already exists, so
> re-run **only** `put-role-policy` with the same `--policy-name` — it overwrites the inline policy
> in place (no `create-role` needed, no redeploy). Takes effect on the next request.

## 3. Vercel project env vars
In the `medconsult_test` project → Settings → Environment Variables (Production + Preview):
- `AWS_ROLE_ARN` = the role ARN from Step 2
- `AWS_REGION` = `us-east-1`  *(REQUIRED — Vercel's auto AWS_REGION is unstable across regions)*

```bash
# or via CLI:
vercel env add AWS_ROLE_ARN production   # paste the ARN
vercel env add AWS_REGION  production    # us-east-1
```

## 4. Code (already wired in this PR)
`lib/bedrock.ts` and `lib/ssm-prompts.ts` use `awsCredentialsProvider({ roleArn })` from
`@vercel/oidc-aws-credentials-provider` **only when `AWS_ROLE_ARN` is set** (Vercel). Locally
(no `AWS_ROLE_ARN`) they fall back to the default credential chain (your SSO). Nothing else to do.

## 5. 🔒 URL gate — REQUIRED, and BEFORE Step 3

Two POC routes are intentionally **unauthenticated** and must NOT be publicly reachable:
- `GET /api/aws-stt-creds` — **mints short-lived AWS creds** (scoped to this role: Bedrock + the
  POC SSM namespace + Transcribe). An anonymous caller could otherwise obtain them.
- `POST /api/prompts` — writes to the test SSM namespace (no prod impact, but still a write).

**Enable Vercel Deployment Protection BEFORE you set `AWS_ROLE_ARN` (Step 3).** With no
`AWS_ROLE_ARN`, the creds route returns 500 (can't mint anything) — so the safe order is: **gate
the URL first, then enable AWS.** Project → Settings → **Deployment Protection** → Vercel
Authentication (or Password). Only invited users reach the app — the agreed POC control (option 1).

**Hardening (production):** scope the creds route down to a **Transcribe-only** role via an STS
session policy (so leaked creds can't touch Bedrock/SSM), or switch it to return a **presigned
Transcribe WebSocket URL** instead of credentials. The **real prompt admin** (writing to prod SSM)
must have proper auth + admin-role + audit + versioning — never the unauthenticated POC routes.

## 6. Verify
After Steps 1–3 + a redeploy: open `/prompts`, edit a prompt, **Guardar** → should return `ok`
(SSM write via OIDC, no static key). Bedrock extraction (`engine: "bedrock"`) likewise works.
