import type { SVGProps } from 'react'

/**
 * Small inline SVG icon set (vector, theme-able via currentColor) so the UI never
 * relies on emoji for structural icons. Stroke 1.8, rounded — friendly + clinical.
 */
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function LogoMark(props: SVGProps<SVGSVGElement>) {
  // Stethoscope mark.
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M4 3v6a4 4 0 0 0 8 0V3" />
      <path d="M8 17a6 6 0 0 0 12 0v-2" />
      <circle cx="20" cy="11" r="2.2" />
      <path d="M4 3H3M12 3h1" />
    </svg>
  )
}

export function IconSparkles(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" />
      <path d="M19 14l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7L19 14z" />
    </svg>
  )
}

export function IconTranscript(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  )
}

export function IconClipboardCheck(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <rect x="5" y="4" width="14" height="17" rx="2.5" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="M9 13l2 2 4-4" />
    </svg>
  )
}

export function IconMic(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
}

export function IconRefresh(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  )
}

export function Spinner(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props} className={`animate-spin ${props.className ?? ''}`} aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  )
}
