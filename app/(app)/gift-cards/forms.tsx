'use client'

import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { cardLifecycleAction, editRecipientAction, resendAllAction, resendCardAction, type ActionState } from './actions'

function Submit({ label, busy, tone = 'plain' }: { label: string; busy: string; tone?: 'plain' | 'primary' }) {
  const { pending } = useFormStatus()
  return (
    <button
      disabled={pending}
      className={
        tone === 'primary'
          ? 'h-10 rounded-full bg-brand px-4 text-sm font-semibold text-forest hover:bg-brand-pressed hover:text-cream disabled:opacity-60'
          : 'h-10 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken disabled:opacity-60'
      }
    >
      {pending ? busy : label}
    </button>
  )
}

function Result({ state }: { state: ActionState }) {
  if (!state.message) return null
  return (
    <p role="status" dir="auto" className={state.ok ? 'text-sm text-ok' : 'text-sm text-bad'}>
      {state.message}
    </p>
  )
}

const input = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm'

export function ResendCardForm({ id, label }: { id: string; label: string }) {
  const [state, action] = useFormState<ActionState, FormData>(resendCardAction, {})
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(`Send card ${label} to its recipient again?`)) e.preventDefault() }} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Reason (stored in both audit logs)</span>
        <input name="reason" required minLength={3} maxLength={500} dir="auto" placeholder="Customer says it never arrived" className={input} />
      </label>
      <div><Submit label="Resend email" busy="Sending…" /></div>
      <Result state={state} />
    </form>
  )
}

export function EditRecipientForm({ id, label, current }: { id: string; label: string; current: { name: string; email: string; phone: string | null } }) {
  const [state, action] = useFormState<ActionState, FormData>(editRecipientAction, {})
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(`Change the recipient of card ${label}?`)) e.preventDefault() }} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <p className="text-xs text-muted">Leave a field empty to keep it. The gift card system checks these with the same rules as checkout.</p>
      <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Name</span><input name="recipientName" dir="auto" placeholder={current.name} className={input} /></label>
      <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Email</span><input name="recipientEmail" type="email" dir="ltr" placeholder={current.email} className={input} /></label>
      <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Mobile</span><input name="recipientPhone" type="tel" dir="ltr" placeholder={current.phone ?? '05x-xxxxxxx'} className={input} /></label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Reason (stored in both audit logs)</span>
        <input name="reason" required minLength={3} maxLength={500} dir="auto" placeholder="Address bounced" className={input} />
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="resend" defaultChecked className="h-4 w-4" /> Send the card to the new details now</label>
      <div><Submit label="Save recipient" busy="Saving…" tone="primary" /></div>
      <Result state={state} />
    </form>
  )
}

export function ResendAllForm({ count }: { count: number }) {
  const [state, action] = useFormState<ActionState, FormData>(resendAllAction, {})
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(`Resend every paid card whose email did not go out (${count} in the last window)? Cards rejected by the recipient's server are skipped.`)) e.preventDefault() }} className="flex flex-col gap-2">
      <div><Submit label="Resend all undelivered" busy="Sending…" tone="primary" /></div>
      <Result state={state} />
    </form>
  )
}

export type CardOpOption = { op: string; label: string; hint: string; confirm: string }

/**
 * Owner-only money actions. One form, one action at a time, each behind a
 * confirmation that says what will happen to the money. `requestId` makes a
 * double-submitted balance adjustment count once; a new one is drawn after
 * every answer.
 */
export function CardLifecycleForm({ id, label, options }: { id: string; label: string; options: CardOpOption[] }) {
  const [state, action] = useFormState<ActionState, FormData>(cardLifecycleAction, {})
  const [op, setOp] = useState(options[0]?.op ?? '')
  const [requestId, setRequestId] = useState('')
  useEffect(() => setRequestId(crypto.randomUUID()), [state])
  const chosen = options.find((o) => o.op === op)
  if (!options.length) return <p className="text-sm text-muted">No money action applies to a card in this status.</p>
  return (
    <form action={action} onSubmit={(e) => { if (!chosen || !window.confirm(`Card ${label}: ${chosen.confirm}`)) e.preventDefault() }} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="requestId" value={requestId} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Action</span>
        <select name="op" value={op} onChange={(e) => setOp(e.target.value)} className={input}>
          {options.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
        </select>
      </label>
      {chosen ? <p className="text-xs text-muted">{chosen.hint}</p> : null}
      {op === 'adjust' ? (
        <div className="flex gap-2">
          <select name="direction" className={`${input} w-32`} defaultValue="increase">
            <option value="increase">Add</option>
            <option value="decrease">Remove</option>
          </select>
          <input name="amount" inputMode="decimal" required dir="ltr" placeholder="Amount in ₪" className={input} />
        </div>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Reason (stored in both audit logs)</span>
        <input name="reason" required minLength={3} maxLength={500} dir="auto" placeholder="Verified in Grow on 22/10" className={input} />
      </label>
      <div><Submit label="Run" busy="Working…" tone="primary" /></div>
      <Result state={state} />
    </form>
  )
}
