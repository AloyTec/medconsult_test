// __tests__/historial-page.test.tsx
// jsdom (default): render de la lista con fetch mockeado.
import { render, screen, waitFor } from '@testing-library/react'
import HistorialPage from '@/app/historial/page'

const LIST = {
  atenciones: [
    {
      id: '01JZXA0000000000000000000A',
      createdAt: '2026-07-10T14:30:00.000Z',
      updatedAt: '2026-07-10T14:35:00.000Z',
      pseudonym: 'Paciente A1B2',
      runsCount: 3,
      lastDiagnostico: 'gastritis aguda',
      hasValidation: true,
      hasSummary: false,
    },
  ],
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => LIST,
  }) as jest.Mock
})

it('renders the list with pseudonym, diagnosis and badges', async () => {
  render(<HistorialPage />)
  await waitFor(() => expect(screen.getByText('Paciente A1B2')).toBeInTheDocument())
  expect(screen.getByText(/gastritis aguda/)).toBeInTheDocument()
  expect(screen.getByText(/3 corridas/)).toBeInTheDocument()
  expect(screen.getByText(/Validada/)).toBeInTheDocument()
})

it('shows the empty state', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ atenciones: [] }) })
  render(<HistorialPage />)
  await waitFor(() => expect(screen.getByText(/Todavía no hay atenciones/)).toBeInTheDocument())
})
