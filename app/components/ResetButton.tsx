'use client'

import { IconRefresh } from './icons'

/**
 * "Empezar de cero": recarga la página para volver a un estado limpio — dictado y
 * extracción vacíos, controles en sus valores por defecto y el prompt recargado
 * desde SSM (se descartan ediciones de prompt sin guardar). Confirma antes para
 * evitar perder trabajo por accidente.
 */
export function ResetButton() {
  return (
    <button
      type="button"
      onClick={() => {
        if (
          window.confirm(
            '¿Empezar de cero? Se limpiarán el dictado y la extracción. Las ediciones de prompt sin guardar se perderán.'
          )
        ) {
          window.location.assign('/prompts')
        }
      }}
      className="inline-flex items-center gap-2 rounded-[10px] border border-stroke bg-white px-3 py-2 text-sm font-semibold text-muted transition-colors hover:border-primary hover:text-primary max-sm:min-h-11"
      title="Limpiar el dictado y la extracción para empezar una nueva consulta"
    >
      {/* En teléfono queda icono-solo (el texto sigue disponible para lectores). */}
      <IconRefresh className="h-4 w-4" />
      <span className="sr-only sm:not-sr-only">Empezar de cero</span>
    </button>
  )
}
