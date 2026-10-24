'use client'

import { useFormStatus } from 'react-dom'
import { cn } from '@/lib/cn'

/** A submit button that says it is working and cannot be pressed twice. */
export function Submit({ children, busy, className, name, value }: { children: React.ReactNode; busy?: string; className: string; name?: string; value?: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" name={name} value={value} disabled={pending} aria-busy={pending} className={cn(className)}>
      {pending ? (busy ?? 'רגע…') : children}
    </button>
  )
}
