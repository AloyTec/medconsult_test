import { NextRequest, NextResponse } from 'next/server'
import { getAtencion } from '@/lib/atenciones'
import { isUlid } from '@/lib/ulid'

/** Detalle completo de una atención (transcript + runs + validación + resumen). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isUlid(id)) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 })
  }
  try {
    const atencion = await getAtencion(id)
    if (!atencion) {
      return NextResponse.json({ error: 'Atención no encontrada' }, { status: 404 })
    }
    return NextResponse.json(atencion)
  } catch (error) {
    console.error('GET /api/atenciones/[id] error:', error)
    return NextResponse.json({ error: 'No se pudo leer la atención' }, { status: 500 })
  }
}
