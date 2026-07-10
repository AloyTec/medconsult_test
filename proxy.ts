// proxy.ts (Next 16: sucesor de middleware.ts, runtime nodejs).
// Protege TODAS las páginas y APIs detrás del código de acceso — incluidas las
// rutas hoy abiertas (Bedrock, credenciales Transcribe, SSM). Inerte sin env vars.
import { NextRequest, NextResponse } from 'next/server'
import { ACCESS_COOKIE, decideAccess } from '@/lib/access-gate'

export default function proxy(request: NextRequest) {
  const decision = decideAccess(
    request.nextUrl.pathname,
    request.cookies.get(ACCESS_COOKIE)?.value,
    { code: process.env.POC_ACCESS_CODE, secret: process.env.POC_COOKIE_SECRET }
  )
  if (decision === 'unauthorized-api') {
    return NextResponse.json({ error: 'Acceso no autorizado' }, { status: 401 })
  }
  if (decision === 'redirect-acceso') {
    return NextResponse.redirect(new URL('/acceso', request.nextUrl))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
