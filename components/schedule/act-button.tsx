'use client'

import { useState, useTransition } from 'react'
import type { ActResult } from '@/lib/schedule/act'

type Tone = 'primary' | 'strong' | 'plain' | 'danger'
const TONE: Record<Tone, string> = {
  // Orange is the ONE main action on a screen (assign); everything else is quieter.
  primary: 'bg-brand text-forest hover:bg-brand-pressed hover:text-cream',
  strong: 'bg-forest text-cream hover:bg-forest/90',
  plain: 'border border-line bg-surface text-ink hover:bg-sunken',
  danger: 'border border-bad/30 bg-surface text-bad hover:bg-bad/5',
}

/**
 * One tap → one server action, with its outcome said in words next to it.
 * `confirm` asks first (for anything that takes a person off a day).
 */
export function ActButton<A>({ action, args, label, pendingLabel, tone = 'plain', confirm, className = '', small }: {
  action: (a: A) => Promise<ActResult>
  args: A
  label: string
  pendingLabel?: string
  tone?: Tone
  confirm?: string
  className?: string
  small?: boolean
}) {
  const [pending, start] = useTransition()
  const [res, setRes] = useState<ActResult | null>(null)
  return (
    <span className={`inline-flex flex-col gap-1 ${className}`}>
      <button
        type="button"
        disabled={pending}
        data-compact={small ? '' : undefined}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return
          setRes(null)
          start(async () => setRes(await action(args).catch(() => ({ ok: false, message: 'הבקשה נכשלה. נא לבדוק את המסך לפני שמנסים שוב.' }))))
        }}
        className={`inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition-colors duration-150 active:scale-[0.98] disabled:opacity-60 ${small ? 'min-h-9 px-3 text-xs' : 'min-h-11 px-4 text-sm'} ${TONE[tone]}`}
      >
        {pending ? (pendingLabel ?? 'רגע…') : label}
      </button>
      {res && !res.ok ? <span role="alert" className="text-xs text-bad">{res.message}</span> : null}
      {res && res.ok ? <span role="status" className="text-xs text-ok">{res.message}</span> : null}
    </span>
  )
}
