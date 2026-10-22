'use client'

import { useState } from 'react'
import { useFormState } from 'react-dom'
import { savePartnersAction, saveShopHoursAction, setContentAction, type ActionState } from './actions'
import { Result, Submit, input } from './forms'
import { ImageUpload } from './image-upload'

const area = 'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm'

export interface ContentFieldValues {
  key: string
  label: string
  type: 'text' | 'textarea' | 'image' | 'video'
  value: string
  updatedAt: string | null
}

/** One site_content key, edited in place. Long texts may carry simple formatting (<p>, <strong>, <a>). */
export function ContentField({ item }: { item: ContentFieldValues }) {
  const [state, action] = useFormState<ActionState, FormData>(setContentAction, {})
  const media = item.type === 'image' || item.type === 'video'
  const [value, setValue] = useState(item.value)
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Change "${item.label}" on the live site?`)) e.preventDefault()
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="key" value={item.key} />
      <input type="hidden" name="was" value={item.value} />
      <input type="hidden" name="expectUpdatedAt" value={item.updatedAt ?? ''} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">
          <span dir="auto">{item.label}</span> · <span dir="ltr" className="text-meta">{item.key}</span>
          {item.updatedAt ? null : <span className="text-meta"> · default</span>}
        </span>
        {item.type === 'textarea' ? (
          <textarea name="value" defaultValue={item.value} rows={Math.min(10, Math.max(3, Math.ceil(item.value.length / 90)))} maxLength={15000} dir="auto" className={area} />
        ) : (
          <input name="value" value={value} onChange={(e) => setValue(e.target.value)} maxLength={media ? 2000 : 500} dir={media ? 'ltr' : 'auto'} placeholder={media ? 'https://… or /images/…' : ''} className={input} />
        )}
      </label>
      {item.type === 'image' ? <ImageUpload folder="content" label="Upload a new image" onUploaded={setValue} /> : null}
      {media && item.value ? (
        <a href={item.value} target="_blank" rel="noreferrer noopener" className="text-xs underline-offset-2 hover:underline" dir="ltr">Open current {item.type}</a>
      ) : null}
      <div><Submit label="Save" busy="Saving…" /></div>
      <Result state={state} />
    </form>
  )
}

export interface KeyState {
  value: string
  updatedAt: string | null
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The manager's שעות החנות: when online payment is open. The shop itself is always visible. */
export function ShopHoursForm({ keys }: { keys: Record<'shop_status_override' | 'shop_open_from' | 'shop_open_to' | 'shop_open_days', KeyState> }) {
  const [state, action] = useFormState<ActionState, FormData>(saveShopHoursAction, {})
  const days = new Set(keys.shop_open_days.value.split(',').filter(Boolean))
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm('Change when online payment is open on the live site?')) e.preventDefault()
      }}
      className="flex flex-col gap-3"
    >
      {Object.entries(keys).map(([k, v]) => (
        <span key={k}>
          <input type="hidden" name={`was_${k}`} value={v.value} />
          <input type="hidden" name={`at_${k}`} value={v.updatedAt ?? ''} />
        </span>
      ))}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Mode</span>
        <select name="shop_status_override" defaultValue={keys.shop_status_override.value} className="h-10 rounded-md border border-line bg-surface px-2 text-sm sm:w-64">
          <option value="auto">Automatic (by the hours below)</option>
          <option value="open">Open now (manual)</option>
          <option value="closed">Closed now (manual)</option>
        </select>
      </label>
      <div className="grid gap-2 sm:grid-cols-2 sm:w-96">
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Opens</span><input type="time" name="shop_open_from" defaultValue={keys.shop_open_from.value} required className={input} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Closes</span><input type="time" name="shop_open_to" defaultValue={keys.shop_open_to.value} required className={input} /></label>
      </div>
      <p className="text-xs text-muted">A closing time earlier than the opening time means overnight (for example 17:00 to 07:00). Israel time.</p>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1 text-sm text-muted">Days</legend>
        {DAYS.map((d, i) => (
          <label key={d} className="flex min-h-11 items-center gap-2 rounded-full border border-line px-3 text-sm">
            <input type="checkbox" name="day" value={i} defaultChecked={days.has(String(i))} className="h-4 w-4" /> {d}
          </label>
        ))}
      </fieldset>
      <div><Submit label="Save hours" busy="Saving…" tone="primary" /></div>
      <Result state={state} />
    </form>
  )
}

export function PartnersForm({ raw, updatedAt }: { raw: string; updatedAt: string | null }) {
  const [state, action] = useFormState<ActionState, FormData>(savePartnersAction, {})
  let partners: { name: string; logo: string }[] = []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) partners = parsed.filter((p) => p && typeof p.name === 'string' && typeof p.logo === 'string')
  } catch {
    /* shown as empty; saving rewrites a valid list */
  }
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm('Update the partner logos on the live home page?')) e.preventDefault()
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="was" value={raw} />
      <input type="hidden" name="expectUpdatedAt" value={updatedAt ?? ''} />
      {partners.length ? (
        <ul className="flex flex-col gap-2">
          {partners.map((p, i) => (
            <li key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
              <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Name</span><input name="name" defaultValue={p.name} maxLength={100} dir="auto" className={input} /></label>
              <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Logo link</span><input name="logo" defaultValue={p.logo} maxLength={2000} dir="ltr" className={input} /></label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="remove" value={i} className="h-4 w-4" /> Remove</label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No partners yet.</p>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Add partner: name</span><input name="new_name" maxLength={100} dir="auto" className={input} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Logo link (https:// or /path)</span><input name="new_logo" maxLength={2000} dir="ltr" className={input} /></label>
      </div>
      <div><Submit label="Save partners" busy="Saving…" tone="primary" /></div>
      <Result state={state} />
    </form>
  )
}
