'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { setArchivedAction, setDestinationAction, type ActionState } from './actions'

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus()
  return (
    <button disabled={pending} className="h-10 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken disabled:opacity-60">
      {pending ? busy : label}
    </button>
  )
}

function Result({ state }: { state: ActionState }) {
  if (!state.message) return null
  return <p role="status" dir="auto" className={state.ok ? 'text-xs text-ok' : 'text-xs text-bad'}>{state.message}</p>
}

export function ArchiveForm({ id, name, archived }: { id: string; name: string; archived: boolean }) {
  const [state, action] = useFormState<ActionState, FormData>(setArchivedAction, {})
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(archived ? `Take "${name}" out of the archive?` : `Archive "${name}"? It disappears from the field app's lists (it can be taken back out).`)) e.preventDefault() }} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="archived" value={String(!archived)} />
      <Submit label={archived ? 'Unarchive' : 'Archive project'} busy="Saving…" />
      <Result state={state} />
    </form>
  )
}

export function DestinationForm({ id, projectId, description, from, updatedAt, options }: { id: string; projectId: string; description: string; from: string | null; updatedAt: string; options: { id: string; label: string }[] }) {
  const [state, action] = useFormState<ActionState, FormData>(setDestinationAction, {})
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const to = options.find((o) => o.id === new FormData(e.currentTarget).get('to'))?.label
        if (!window.confirm(`Move "${description}" to ${to}?`)) e.preventDefault()
      }}
      className="flex flex-col gap-1"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="from" value={from ?? ''} />
      <input type="hidden" name="expectUpdatedAt" value={updatedAt} />
      <div className="flex items-center gap-2">
        <label><span className="sr-only">Destination</span>
          <select name="to" defaultValue={from ?? ''} className="h-10 rounded-md border border-line bg-surface px-2 text-sm" dir="rtl">
            {from ? null : <option value="">—</option>}
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <Submit label="Move" busy="…" />
      </div>
      <Result state={state} />
    </form>
  )
}
