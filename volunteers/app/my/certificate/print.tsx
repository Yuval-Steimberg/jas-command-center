'use client'

import { Printer } from 'lucide-react'
import { secondaryBtn } from '@/components/ui'

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={`${secondaryBtn} mt-5 w-full print:hidden`}>
      <Printer aria-hidden className="h-5 w-5" strokeWidth={1.75} />הדפסה או שמירה כ-PDF
    </button>
  )
}
