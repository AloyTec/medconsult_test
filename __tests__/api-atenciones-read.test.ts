/**
 * @jest-environment node
 */
// __tests__/api-atenciones-read.test.ts
import { NextRequest } from 'next/server'
import { GET as listGET } from '@/app/api/atenciones/route'
import { GET as detailGET } from '@/app/api/atenciones/[id]/route'
import { listAtenciones, getAtencion } from '@/lib/atenciones'

jest.mock('@/lib/atenciones', () => ({
  listAtenciones: jest.fn().mockResolvedValue({ items: [], nextToken: undefined }),
  getAtencion: jest.fn().mockResolvedValue(null),
}))

const ID = '01JZXA0000000000000000000A'

beforeEach(() => jest.clearAllMocks())

describe('GET /api/atenciones', () => {
  it('returns the list with clamped limit and optional cursor', async () => {
    const res = await listGET(new NextRequest(`http://localhost/api/atenciones?limit=500&cursor=${ID}`))
    expect(res.status).toBe(200)
    expect(listAtenciones).toHaveBeenCalledWith(100, ID) // 500 → clamp 100
    await expect(res.json()).resolves.toEqual({ atenciones: [] })
  })

  it('defaults to limit 50', async () => {
    await listGET(new NextRequest('http://localhost/api/atenciones'))
    expect(listAtenciones).toHaveBeenCalledWith(50, undefined)
  })

  it('500s with a safe message when the repo fails', async () => {
    ;(listAtenciones as jest.Mock).mockRejectedValueOnce(new Error('ddb down'))
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const res = await listGET(new NextRequest('http://localhost/api/atenciones'))
    expect(res.status).toBe(500)
    jest.restoreAllMocks()
  })

  it('400s on a non-ULID cursor', async () => {
    const res = await listGET(new NextRequest('http://localhost/api/atenciones?cursor=garbage'))
    expect(res.status).toBe(400)
    expect(listAtenciones).not.toHaveBeenCalled()
  })
})

describe('GET /api/atenciones/[id]', () => {
  it('400s on a non-ULID id', async () => {
    const res = await detailGET(new NextRequest('http://localhost/api/atenciones/nope'), {
      params: Promise.resolve({ id: 'nope' }),
    })
    expect(res.status).toBe(400)
    expect(getAtencion).not.toHaveBeenCalled()
  })

  it('404s when missing', async () => {
    const res = await detailGET(new NextRequest(`http://localhost/api/atenciones/${ID}`), {
      params: Promise.resolve({ id: ID }),
    })
    expect(res.status).toBe(404)
  })

  it('returns the record', async () => {
    ;(getAtencion as jest.Mock).mockResolvedValueOnce({ pk: 'ATENCION', sk: ID, runs: [] })
    const res = await detailGET(new NextRequest(`http://localhost/api/atenciones/${ID}`), {
      params: Promise.resolve({ id: ID }),
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ sk: ID })
  })
})
