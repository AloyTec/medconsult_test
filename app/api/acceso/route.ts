import { NextRequest, NextResponse } from 'next/server'
import { ACCESS_COOKIE, accessToken } from '@/lib/access-gate'

/** Valida el código compartido y setea la cookie de acceso (30 días). */
export async function POST(req: NextRequest) {
  const code = process.env.POC_ACCESS_CODE
  const secret = process.env.POC_COOKIE_SECRET
  if (!code || !secret) {
    return NextResponse.json({ error: 'El acceso no está configurado.' }, { status: 500 })
  }
  const body = (await req.json().catch(() => ({}))) as { code?: unknown }
  if (typeof body.code !== 'string' || body.code !== code) {
    return NextResponse.json({ error: 'Código incorrecto.' }, { status: 401 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: ACCESS_COOKIE,
    value: accessToken(secret, code),
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return res
}
