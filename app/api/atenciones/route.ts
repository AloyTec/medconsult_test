import { NextRequest, NextResponse } from 'next/server'
import { listAtenciones } from '@/lib/atenciones'
import { isUlid } from '@/lib/ulid'

/**
 * Lista del historial, newest-first. Proyección liviana (sin runs ni transcript).
 * GET /api/atenciones?limit=50&cursor=<ulid> → { atenciones: [...], nextToken? }
 */
export async function GET(req: NextRequest) {
  try {
    const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? 50)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 50
    const cursor = req.nextUrl.searchParams.get('cursor') ?? undefined
    if (cursor && !isUlid(cursor)) {
      return NextResponse.json({ error: 'cursor inválido' }, { status: 400 })
    }
    const { items, nextToken } = await listAtenciones(limit, cursor)
    return NextResponse.json({ atenciones: items, ...(nextToken ? { nextToken } : {}) })
  } catch (error) {
    console.error('GET /api/atenciones error:', error)
    return NextResponse.json({ error: 'No se pudo leer el historial' }, { status: 500 })
  }
}
