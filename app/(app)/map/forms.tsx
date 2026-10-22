'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { proposePlaceAction, removePlaceAction, type ActionState } from './actions'

type Place = { id: number; name: string; sub: string | null; cat: string; lat: number; lng: number; desc: string | null; hours: string | null; contact: string | null; address: string | null }

const input = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm'

function Submit({ label, danger }: { label: string; danger?: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button disabled={pending} className={danger ? 'h-10 rounded-full border border-bad px-4 text-sm font-semibold text-bad hover:bg-sunken disabled:opacity-60' : 'h-10 rounded-full bg-brand px-4 text-sm font-semibold text-forest hover:bg-brand-pressed hover:text-cream disabled:opacity-60'}>
      {pending ? 'Opening pull request…' : label}
    </button>
  )
}

/** Add (no place) or edit (with place). Opens a pull request; nothing is published until it is merged. */
export function PlaceForm({ place, categories }: { place?: Place; categories: { key: string; label: string }[] }) {
  const [state, action] = useFormState<ActionState, FormData>(proposePlaceAction, {})
  const f = (label: string, name: keyof Place, opts: { dir?: 'ltr' | 'auto'; type?: string; required?: boolean; step?: string } = {}) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <input name={name} type={opts.type ?? 'text'} step={opts.step} required={opts.required} dir={opts.dir ?? 'auto'} defaultValue={place ? String(place[name] ?? '') : ''} className={input} />
    </label>
  )
  return (
    <form action={action} className="flex flex-col gap-2">
      {place ? <input type="hidden" name="id" value={place.id} /> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {f('Name', 'name', { required: true })}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Category</span>
          <select name="cat" defaultValue={place?.cat ?? categories[0]?.key} className={input}>
            {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        {f('Subtitle', 'sub')}
        {f('Address', 'address')}
        {f('Latitude', 'lat', { dir: 'ltr', type: 'number', step: 'any', required: true })}
        {f('Longitude', 'lng', { dir: 'ltr', type: 'number', step: 'any', required: true })}
        {f('Hours', 'hours')}
        {f('Contact', 'contact')}
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Description</span>
        <textarea name="desc" rows={3} dir="auto" defaultValue={place?.desc ?? ''} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Reason (goes into the pull request and the audit log)</span>
        <input name="reason" required minLength={3} maxLength={300} dir="auto" className={input} />
      </label>
      <p className="text-xs text-muted">Opens a pull request on the map repository. The public map changes only after it is merged on GitHub.</p>
      <div><Submit label={place ? 'Propose edit' : 'Propose new place'} /></div>
      {state.message ? (
        <p role="status" dir="auto" className={state.ok ? 'text-sm text-ok' : 'text-sm text-bad'}>
          {state.message} {state.url ? <a href={state.url} target="_blank" rel="noreferrer" className="underline">Review it on GitHub</a> : null}
        </p>
      ) : null}
    </form>
  )
}

/** Remove a place: asks first, then opens a pull request that deletes its line. */
export function RemovePlaceForm({ place }: { place: { id: number; name: string } }) {
  const [state, action] = useFormState<ActionState, FormData>(removePlaceAction, {})
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Propose removing "${place.name}" from the map? Nothing changes until you merge the pull request on GitHub.`)) e.preventDefault()
      }}
      className="flex flex-col gap-2 border-t border-line pt-4"
    >
      <input type="hidden" name="id" value={place.id} />
      <p className="text-sm font-semibold" dir="auto">Remove {place.name}</p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Reason (goes into the pull request and the audit log)</span>
        <input name="reason" required minLength={3} maxLength={300} dir="auto" className={input} />
      </label>
      <div><Submit label="Propose removal" danger /></div>
      {state.message ? (
        <p role="status" dir="auto" className={state.ok ? 'text-sm text-ok' : 'text-sm text-bad'}>
          {state.message} {state.url ? <a href={state.url} target="_blank" rel="noreferrer" className="underline">Review it on GitHub</a> : null}
        </p>
      ) : null}
    </form>
  )
}
