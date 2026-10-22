'use client'

import { useFormState } from 'react-dom'
import { deleteDiscountAction, deleteSubscriberAction, saveDiscountAction, type ActionState } from './actions'
import { Result, Submit, input } from './forms'

export interface DiscountValues {
  code: string
  type: 'percent' | 'amount'
  value: number
  expiresAt?: string
  usageLimit?: number
  minOrder?: number
  notes?: string
  active: boolean
}

const select = 'h-10 rounded-md border border-line bg-surface px-2 text-sm'

/** Create (no `d`) or edit one code. The code itself is fixed once created, as in the manager. */
export function DiscountForm({ d }: { d?: DiscountValues }) {
  const [state, action] = useFormState<ActionState, FormData>(saveDiscountAction, {})
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const f = new FormData(e.currentTarget)
        const code = String(f.get('code') ?? '').toUpperCase()
        const active = f.get('active') === 'on'
        const msg = d
          ? `Save changes to ${code}?${active ? ' Checkout uses the new terms immediately.' : ' It will stop working at checkout.'}`
          : `Create ${code}?${active ? ' Anyone who has the code can use it at checkout immediately.' : ''}`
        if (!window.confirm(msg)) e.preventDefault()
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="mode" value={d ? 'update' : 'create'} />
      {d ? <input type="hidden" name="was" value={JSON.stringify(d)} /> : null}
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Code *</span>
          {d ? <input name="code" value={d.code} readOnly dir="ltr" className={`${input} bg-sunken`} /> : <input name="code" required maxLength={30} pattern="[A-Za-z0-9_-]{2,30}" dir="ltr" placeholder="SUMMER25" className={`${input} uppercase`} />}
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Type</span>
          <select name="type" defaultValue={d?.type ?? 'percent'} className={select}>
            <option value="percent">Percent off</option>
            <option value="amount">₪ off</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Discount *</span>
          <input name="value" required defaultValue={d?.value ?? 10} inputMode="decimal" dir="ltr" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Minimum order ₪</span>
          <input name="minOrder" defaultValue={d?.minOrder ?? ''} inputMode="decimal" dir="ltr" placeholder="none" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Expires on</span>
          <input name="expiresAt" type="date" defaultValue={d?.expiresAt?.slice(0, 10) ?? ''} dir="ltr" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Usage limit</span>
          <input name="usageLimit" defaultValue={d?.usageLimit ?? ''} inputMode="numeric" dir="ltr" placeholder="unlimited" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2"><span className="text-muted">Internal notes</span>
          <input name="notes" defaultValue={d?.notes ?? ''} maxLength={500} dir="auto" className={input} />
        </label>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={d?.active ?? true} className="h-4 w-4" /> Active (usable at checkout)</label>
      <div><Submit label={d ? 'Save code' : 'Create code'} busy="Saving…" tone={d ? 'plain' : 'primary'} /></div>
      <Result state={state} />
    </form>
  )
}

export function DeleteDiscount({ d }: { d: DiscountValues }) {
  const [state, action] = useFormState<ActionState, FormData>(deleteDiscountAction, {})
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Delete ${d.code}? Customers who have it can no longer use it, and its usage count is lost. To pause it instead, untick Active.`)) e.preventDefault()
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="code" value={d.code} />
      <input type="hidden" name="was" value={JSON.stringify(d)} />
      <div><button className="h-10 rounded-full border border-line px-4 text-sm font-medium text-bad hover:bg-sunken">Delete code</button></div>
      <Result state={state} />
    </form>
  )
}

export function DeleteSubscriber({ id, email }: { id: number; email: string }) {
  const [state, action] = useFormState<ActionState, FormData>(deleteSubscriberAction, {})
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Unsubscribe ${email}? They will get no further newsletters.`)) e.preventDefault()
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="id" value={id} />
      <button className="h-10 rounded-full border border-line px-3 text-sm hover:bg-sunken">Unsubscribe</button>
      <Result state={state} />
    </form>
  )
}
