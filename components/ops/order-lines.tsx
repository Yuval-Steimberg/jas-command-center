'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { input } from '@/app/(app)/website/forms'

export interface LineDraft {
  description: string
  quantity: number
  category: string | null
  /** Shekels as typed, e.g. "120" or "99.90". */
  cost: string
}

/**
 * The lines of a purchase order: add as many as needed, remove any. Each row
 * posts desc/qty/category/cost in order; empty rows are ignored by the server.
 */
export function OrderLines({ initial, showCost, categories }: { initial?: LineDraft[]; showCost: boolean; categories: string[] }) {
  const blank = (): LineDraft & { key: number } => ({ key: Math.random(), description: '', quantity: 1, category: null, cost: '' })
  const [rows, setRows] = useState(() => (initial?.length ? initial.map((l) => ({ ...l, key: Math.random() })) : [blank()]))
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm text-muted">What you are ordering</legend>
      <datalist id="po-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      {rows.map((r, i) => (
        <div key={r.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-line/70 bg-ground/40 p-2 sm:grid-cols-[minmax(0,3fr)_5rem_minmax(0,2fr)_7rem_auto] sm:items-end">
          <label className="col-span-2 flex min-w-0 flex-col gap-1 text-sm sm:col-span-1">
            <span className="text-muted">Item {i + 1}</span>
            <input name="desc" defaultValue={r.description} dir="auto" maxLength={300} placeholder="e.g. Oak chair" className={input} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="text-muted">Qty</span>
            <input name="qty" type="number" min={1} max={10000} step={1} defaultValue={r.quantity} dir="ltr" className={input} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="text-muted">Category</span>
            <input name="category" list="po-categories" defaultValue={r.category ?? ''} dir="auto" maxLength={100} className={input} />
          </label>
          {showCost ? (
            <label className="flex min-w-0 flex-col gap-1 text-sm">
              <span className="text-muted">Unit cost ₪</span>
              <input name="cost" inputMode="decimal" defaultValue={r.cost} dir="ltr" placeholder="optional" className={input} />
            </label>
          ) : (
            <input type="hidden" name="cost" value={r.cost} />
          )}
          <button
            type="button"
            aria-label={`Remove item ${i + 1}`}
            disabled={rows.length === 1}
            onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}
            className="inline-flex h-10 w-10 items-center justify-center self-end rounded-full border border-line text-muted hover:bg-sunken disabled:opacity-40"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setRows((x) => [...x, blank()])} className="inline-flex h-10 items-center gap-1.5 self-start rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken">
        <Plus aria-hidden className="h-4 w-4" /> Add a line
      </button>
    </fieldset>
  )
}
