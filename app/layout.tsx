import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'
import { LogoMark, IconSparkles } from './components/icons'
import { NavLink } from './components/NavLink'
import { ResetButton } from './components/ResetButton'

export const metadata: Metadata = {
  title: 'MedConsult — Estudio de prompts clínicos',
  description:
    'Edita los prompts de la IA y observa, al instante, cómo cambia la extracción de la consulta.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-dvh">
        <header className="sticky top-0 z-20 border-b border-stroke bg-white/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/prompts" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface text-primary">
                <LogoMark className="h-5 w-5" />
              </span>
              <span className="leading-tight">
                <span className="block text-base font-bold text-primary">MedConsult</span>
                <span className="block text-[11px] text-muted">Estudio de prompts clínicos</span>
              </span>
            </Link>
            <nav className="flex items-center gap-2">
              <NavLink href="/prompts">
                <IconSparkles className="h-4 w-4" /> Editor de prompts
              </NavLink>
              <ResetButton />
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>

        <footer className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-muted">
          MedConsult · entorno de pruebas · usa siempre datos de pacientes ficticios
        </footer>
      </body>
    </html>
  )
}
