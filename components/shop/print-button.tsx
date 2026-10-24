'use client'

import { Printer } from 'lucide-react'

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand px-6 text-base font-bold text-forest hover:bg-brand-pressed hover:text-cream">
      <Printer aria-hidden className="h-5 w-5" />{label}
    </button>
  )
}
