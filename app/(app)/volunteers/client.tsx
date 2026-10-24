'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState, useFormStatus } from 'react-dom'
import type { ActionState } from '@/lib/ops/act'
import { Outcome } from '../inventory/forms'

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>

function OpButton({ op, label, tone }: { op: string; label: string; tone?: 'bad' }) {
  const { pending } = useFormStatus()
  return (
    <button name="op" value={op} disabled={pending} className={`h-9 rounded-full border px-3 text-xs font-medium disabled:opacity-60 ${tone === 'bad' ? 'border-bad/40 text-bad hover:bg-bad/5' : 'border-line hover:bg-sunken'}`}>
      {label}
    </button>
  )
}

/** One form, several one-tap operations (attendance on the day). The server re-checks every one. */
export function OpButtons({ action, hidden, ops }: { action: Action; hidden: Record<string, string | number>; ops: { op: string; label: string; tone?: 'bad' }[] }) {
  const [state, run] = useFormState<ActionState, FormData>(action, {})
  return (
    <form action={run} className="flex flex-col gap-1">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="flex flex-wrap gap-1.5">{ops.map((o) => <OpButton key={o.op} {...o} />)}</div>
      <Outcome state={state} />
    </form>
  )
}

/** While a shift is under way, the attendance sheet refreshes itself (QR check-ins appear without a reload). */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, seconds * 1000)
    return () => clearInterval(t)
  }, [router, seconds])
  return null
}

export function PrintButton({ label }: { label: string }) {
  return <button type="button" onClick={() => window.print()} className="h-9 rounded-full border border-line px-3 text-xs font-medium hover:bg-sunken print:hidden">{label}</button>
}
