# Vercel → AWS via OIDC (no static keys) — admin runbook

**Goal:** let the deployed POC's functions call **Bedrock** (extraction) and **SSM** (prompt
persistence) **without any long-lived AWS access key**. Vercel hands each function a short-lived
OIDC token; AWS trusts it and returns ~1h temp creds for a **tightly-scoped role**.

**Why an admin runs this:** creating an IAM OIDC provider + role is IAM-write — a dev SSO role
can't do it. Run the steps below with an **IAM-admin** identity (or port to Pulumi).

**Scope (blast radius):** the role can ONLY `bedrock:InvokeModel` (Haiku) + `ssm:Get/PutParameter`
on `/medconsult/poc/prompts/*`. **No PHI, no other resources.** Code already wired (see Step 4).

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
`permissions-policy.json` (least privilege — Bedrock Haiku + the POC SSM namespace only):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockInvokeHaiku",
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": [
        "arn:aws:bedrock:us-east-1:889268462469:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"
      ]
    },
    {
      "Sid": "PocPromptsSsm",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:PutParameter"],
      "Resource": "arn:aws:ssm:us-east-1:889268462469:parameter/medconsult/poc/prompts/*"
    }
  ]
}
```
Create + attach (IAM-admin profile):
```bash
aws iam create-role --role-name medconsult-poc-vercel \
  --assume-role-policy-document file://trust-policy.json
aws iam put-role-policy --role-name medconsult-poc-vercel \
  --policy-name medconsult-poc-bedrock-ssm \
  --policy-document file://permissions-policy.json
aws iam get-role --role-name medconsult-poc-vercel --query Role.Arn --output text   # copy this ARN
```

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

## 5. 🔒 Gate the URL before sharing (security decision)
`POST /api/prompts` writes to SSM **without auth** (by design for the POC — test namespace, no
prod impact). Before exposing the deploy to doctors, enable **Vercel Deployment Protection**
(project → Settings → Deployment Protection → Vercel Authentication / Password) so only invited
users reach the editor at all. This is the agreed gate (option 1). The **real admin** (writing to
prod SSM) must instead have proper auth + admin-role + audit + versioning.

## 6. Verify
After Steps 1–3 + a redeploy: open `/prompts`, edit a prompt, **Guardar** → should return `ok`
(SSM write via OIDC, no static key). Bedrock extraction (`engine: "bedrock"`) likewise works.
