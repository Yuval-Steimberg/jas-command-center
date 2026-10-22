'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CalendarRange } from 'lucide-react'
import { PRESETS, type Preset } from '@/lib/time'
import { DEFAULT_PRESET } from '@/lib/range'

export function RangeSelect() {
  const router = useRouter()
  const path = usePathname()
  const params = useSearchParams()
  const value = (params.get('range') as Preset | null) ?? DEFAULT_PRESET
  return (
    <label className="relative flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface ps-2.5 pe-1 text-sm text-ink">
      <CalendarRange aria-hidden className="h-4 w-4 text-muted" strokeWidth={1.75} />
      <span className="sr-only">Date range</span>
      <select
        value={value in PRESETS ? value : DEFAULT_PRESET}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString())
          next.set('range', e.target.value)
          router.push(`${path}?${next.toString()}`)
        }}
        className="h-full cursor-pointer appearance-none bg-transparent pe-5 outline-none"
      >
        {Object.entries(PRESETS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
      <span aria-hidden className="pointer-events-none absolute end-2 text-xs text-muted">▾</span>
    </label>
  )
}
