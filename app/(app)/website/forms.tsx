'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { setOrderNotesAction, setOrderStatusAction, updateProductAction, type ActionState } from './actions'

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
const NEXT: Record<string, string[]> = {
  paid: ['processing', 'shipped', 'delivered'],
  processing: ['shipped', 'delivered', 'paid'],
  shipped: ['delivered', 'processing'],
  delivered: ['shipped'],
}

export function OrderStatusForm({ id, orderNumber, status }: { id: number; orderNumber: string; status: string }) {
  const [state, action] = useFormState<ActionState, FormData>(setOrderStatusAction, {})
  const options = NEXT[status]
  if (!options) {
    return <p className="text-xs text-muted">A {status} order&apos;s status is set in the website manager (payment and cancellation are not changed from here).</p>
  }
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const to = new FormData(e.currentTarget).get('to')
        if (!window.confirm(`Change order ${orderNumber} from ${status} to ${to}?`)) e.preventDefault()
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="from" value={status} />
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Fulfilment status</span>
          <select name="to" defaultValue={options[0]} className="h-10 rounded-md border border-line bg-surface px-2 text-sm">
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <Submit label="Update status" busy="Saving…" tone="primary" />
      </div>
      <Result state={state} />
    </form>
  )
}

export function OrderNotesForm({ id, notes }: { id: number; notes: string | null }) {
  const [state, action] = useFormState<ActionState, FormData>(setOrderNotesAction, {})
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Internal notes (shown in the website manager too)</span>
        <textarea name="notes" defaultValue={notes ?? ''} maxLength={4000} rows={3} dir="auto" className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" />
      </label>
      <div><Submit label="Save notes" busy="Saving…" /></div>
      <Result state={state} />
    </form>
  )
}

export interface ProductFormValues {
  id: number
  slug: string
  name: string
  price: number | null
  originalPrice: number | null
  quantity: number | null
  featured: boolean | null
  updatedAt: string
}

export function ProductForm({ p }: { p: ProductFormValues }) {
  const [state, action] = useFormState<ActionState, FormData>(updateProductAction, {})
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const f = new FormData(e.currentTarget)
        const changes = [
          f.get('price') && `price ₪${p.price ?? '—'} → ₪${f.get('price')}`,
          f.get('clearOriginal') ? 'remove the strike-through price' : f.get('original_price') && `strike-through ₪${p.originalPrice ?? '—'} → ₪${f.get('original_price')}`,
          f.get('quantity') && `quantity ${p.quantity ?? '—'} → ${f.get('quantity')}${f.get('quantity') === '0' ? ' (shows as out of stock)' : ''}`,
          f.get('featured') !== 'keep' && `featured → ${f.get('featured')}`,
        ].filter(Boolean)
        if (changes.length && !window.confirm(`Change "${p.name}" on the live shop?\n\n${changes.join('\n')}`)) e.preventDefault()
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="id" value={p.id} />
      <input type="hidden" name="slug" value={p.slug} />
      <input type="hidden" name="expectUpdatedAt" value={p.updatedAt} />
      <input type="hidden" name="was_price" value={p.price ?? ''} />
      <input type="hidden" name="was_original_price" value={p.originalPrice ?? ''} />
      <input type="hidden" name="was_quantity" value={p.quantity ?? ''} />
      <input type="hidden" name="was_featured" value={String(p.featured)} />
      <p className="text-xs text-muted">Leave a field empty to keep it.</p>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Price ₪</span><input name="price" inputMode="decimal" dir="ltr" placeholder={p.price?.toString() ?? ''} className={input} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Strike-through ₪</span><input name="original_price" inputMode="decimal" dir="ltr" placeholder={p.originalPrice?.toString() ?? 'none'} className={input} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Quantity</span><input name="quantity" inputMode="numeric" dir="ltr" placeholder={p.quantity?.toString() ?? ''} className={input} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Featured</span>
          <select name="featured" defaultValue="keep" className="h-10 rounded-md border border-line bg-surface px-2 text-sm">
            <option value="keep">Keep ({p.featured ? 'yes' : 'no'})</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>
      {p.originalPrice != null ? <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="clearOriginal" className="h-4 w-4" /> Remove the strike-through price</label> : null}
      <div><Submit label="Save product" busy="Saving…" tone="primary" /></div>
      <Result state={state} />
    </form>
  )
}
