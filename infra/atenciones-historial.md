# Historial de atenciones — infra (POC)

Todo se ejecuta con el perfil `cloudforge-medconsult` (validado 2026-07-10: DeveloperAccess
puede crear tablas y escribir políticas de rol — no se necesita al admin).

## 1. Tabla DynamoDB

```bash
aws dynamodb create-table \
  --profile cloudforge-medconsult --region us-east-1 \
  --table-name medconsult-poc-atenciones \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=project,Value=medconsult-poc

aws dynamodb wait table-exists --table-name medconsult-poc-atenciones \
  --profile cloudforge-medconsult --region us-east-1
```

## 2. Política del rol OIDC de Vercel (aditiva — NO toca las 2 existentes)

```bash
aws iam put-role-policy \
  --profile cloudforge-medconsult \
  --role-name medconsult-poc-vercel \
  --policy-name medconsult-poc-atenciones-ddb \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "AtencionesTable",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"],
      "Resource": "arn:aws:dynamodb:us-east-1:889268462469:table/medconsult-poc-atenciones"
    }]
  }'
```

## 3. Env vars en Vercel (proyecto `medconsult_test`, team arcturus91s-projects)

```bash
# genera un secreto para la firma de la cookie
openssl rand -hex 32

# desde el directorio del repo (vercel link ya hecho):
vercel env add POC_ACCESS_CODE production   # pega el código a compartir con el doctor
vercel env add POC_COOKIE_SECRET production # pega el hex de arriba
vercel env add POC_ACCESS_CODE preview
vercel env add POC_COOKIE_SECRET preview
```

Nota: el gate es inerte si faltan las dos variables — por eso el deploy es seguro
aunque las env vars se agreguen después del merge (la app queda abierta hasta setearlas,
igual que hoy). Orden recomendado: env vars primero, deploy después.

## 4. Verificación post-deploy

```bash
# sin cookie → páginas redirigen, APIs 401
curl -s -o /dev/null -w '%{http_code}' https://medconsult.cloud-forge-ai.com/api/models   # 401
curl -s -o /dev/null -w '%{http_code}' -L https://medconsult.cloud-forge-ai.com/prompts    # 200 (aterriza en /acceso)

# lectura del historial a nivel de datos
aws dynamodb query --profile cloudforge-medconsult --region us-east-1 \
  --table-name medconsult-poc-atenciones \
  --key-condition-expression 'pk = :pk' \
  --expression-attribute-values '{":pk":{"S":"ATENCION"}}' \
  --no-scan-index-forward --max-items 3
```
