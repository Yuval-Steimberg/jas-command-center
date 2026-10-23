'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { collectAction, finishApartmentAction, handoverAction, reopenApartmentAction, setArchivedAction, setDestinationAction, type ActionState, type FieldState } from './actions'

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

function Hidden({ values }: { values: Record<string, string> }) {
  return <>{Object.entries(values).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>
}

/** Tick or un-tick collected. Un-ticking clears the collector, so it asks first. */
export function CollectForm({ id, projectId, label, collected, updatedAt }: { id: string; projectId: string; label: string; collected: boolean; updatedAt: string }) {
  const [state, action] = useFormState<FieldState, FormData>(collectAction, {})
  return (
    <form action={action} onSubmit={(e) => { if (collected && !window.confirm(`Undo collection of "${label}"? The collector's name is cleared.`)) e.preventDefault() }} className="flex flex-col gap-1">
      <Hidden values={{ id, projectId, label, collected: String(!collected), expectUpdatedAt: updatedAt }} />
      <Submit label={collected ? 'Undo collected' : 'Mark collected'} busy="…" />
      <Result state={state} />
    </form>
  )
}

/** Finish an apartment. When items are outstanding the field app names them, and a second press confirms. */
export function FinishApartmentForm({ id, projectId, label }: { id: string; projectId: string; label: string }) {
  const [state, action] = useFormState<FieldState, FormData>(finishApartmentAction, {})
  return (
    <form action={action} className="flex flex-col gap-1">
      <Hidden values={{ id, projectId, label, confirmOutstanding: String(Boolean(state.needsConfirmation)) }} />
      <Submit label={state.needsConfirmation ? 'Finish anyway' : 'Finish apartment'} busy="…" />
      <Result state={state} />
    </form>
  )
}

export function ReopenApartmentForm({ id, projectId, label }: { id: string; projectId: string; label: string }) {
  const [state, action] = useFormState<FieldState, FormData>(reopenApartmentAction, {})
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(`Reopen ${label}? It goes back to documentation.`)) e.preventDefault() }} className="flex flex-col gap-1">
      <Hidden values={{ id, projectId, label }} />
      <Submit label="Reopen" busy="…" />
      <Result state={state} />
    </form>
  )
}

/** Third-party handover: the recycler took it. Separate from collected, never sets it. */
export function HandoverForm({ id, projectId, label, confirmed, recipient, updatedAt }: { id: string; projectId: string; label: string; confirmed: boolean; recipient: string | null; updatedAt: string }) {
  const [state, action] = useFormState<FieldState, FormData>(handoverAction, {})
  return (
    <form action={action} onSubmit={(e) => { if (confirmed && !window.confirm(`Clear the handover of "${label}"?`)) e.preventDefault() }} className="flex flex-col gap-1">
      <Hidden values={{ id, projectId, label, confirm: String(!confirmed), expectUpdatedAt: updatedAt }} />
      <div className="flex flex-wrap items-center gap-2">
        {confirmed ? (
          <span dir="auto" className="text-xs text-muted">Handed over{recipient ? ` to ${recipient}` : ''}</span>
        ) : (
          <label className="text-xs"><span className="sr-only">Recipient</span>
            <input name="recipient" maxLength={120} placeholder="Recipient (optional)" dir="auto" className="h-10 w-44 rounded-md border border-line bg-surface px-2 text-sm" />
          </label>
        )}
        <Submit label={confirmed ? 'Clear handover' : 'Confirm handover'} busy="…" />
      </div>
      <Result state={state} />
    </form>
  )
}
