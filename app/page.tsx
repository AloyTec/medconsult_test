import { redirect } from 'next/navigation'

// El editor de prompts es la vista principal: el dictado en vivo ya vive ahí
// (mic → transcripción → extracción), así que la raíz lleva directo al editor.
export default function Home() {
  redirect('/prompts')
}
