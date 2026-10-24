'use client'

import { useFormState } from 'react-dom'
import { useEffect, useRef } from 'react'
import type { State } from '@/app/actions'
import { Notice } from './ui'
import { Submit } from './submit'

type Action = (p: State, f: FormData) => Promise<State>

/**
 * A server-action form that shows the result where the person pressed. The
 * message is announced to screen readers and scrolled into view on a phone.
 */
export function ActionForm({ action, hidden, children, submit, busy, btnClass, className, resetOnOk }: {
  action: Action
  hidden?: Record<string, string>
  children?: React.ReactNode
  submit: React.ReactNode
  busy?: string
  btnClass: string
  className?: string
  resetOnOk?: boolean
}) {
  const [state, run] = useFormState(action, {})
  const msg = useRef<HTMLDivElement>(null)
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (state.message) msg.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    if (state.ok && resetOnOk) form.current?.reset()
  }, [state, resetOnOk])
  return (
    <form ref={form} action={run} className={className}>
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <Submit className={btnClass} busy={busy}>{submit}</Submit>
      <div ref={msg} aria-live="polite" className="empty:hidden mt-3">
        {state.message ? <Notice tone={state.ok ? 'ok' : 'bad'}>{state.message}</Notice> : null}
      </div>
    </form>
  )
}
