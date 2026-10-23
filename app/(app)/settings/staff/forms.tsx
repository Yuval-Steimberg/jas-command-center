'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { inviteAction, setActiveAction, setRoleAction, type StaffState } from './actions'

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus()
  return <button disabled={pending} className="h-10 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken disabled:opacity-60">{pending ? busy : label}</button>
}
function Result({ state }: { state: StaffState }) {
  return state.message ? <p role="status" className={state.ok ? 'text-xs text-ok' : 'text-xs text-bad'}>{state.message}</p> : null
}
type Opt = { id: string; label: string }

export function InviteForm({ roles }: { roles: Opt[] }) {
  const [state, action] = useFormState<StaffState, FormData>(inviteAction, {})
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-muted">Name<input name="name" required maxLength={100} dir="auto" className="h-10 w-48 rounded-md border border-line bg-surface px-2 text-sm text-ink" /></label>
        <label className="flex flex-col text-xs text-muted">Email<input name="email" type="email" required maxLength={200} dir="ltr" className="h-10 w-64 rounded-md border border-line bg-surface px-2 text-sm text-ink" /></label>
        <label className="flex flex-col text-xs text-muted">Role
          <select name="role" defaultValue="viewer" className="h-10 rounded-md border border-line bg-surface px-2 text-sm text-ink">{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        </label>
        <Submit label="Send invitation" busy="Sending…" />
      </div>
      <Result state={state} />
    </form>
  )
}

export function RoleForm({ id, email, role, roles }: { id: string; email: string; role: string | null; roles: Opt[] }) {
  const [state, action] = useFormState<StaffState, FormData>(setRoleAction, {})
  return (
    <form action={action} onSubmit={(e) => { const to = roles.find((r) => r.id === new FormData(e.currentTarget).get('role'))?.label; if (!window.confirm(`Change ${email} to ${to}?`)) e.preventDefault() }} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-2">
        <label><span className="sr-only">Role for {email}</span>
          <select name="role" defaultValue={role ?? ''} className="h-10 rounded-md border border-line bg-surface px-2 text-sm">{role ? null : <option value="">—</option>}{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        </label>
        <Submit label="Change" busy="…" />
      </div>
      <Result state={state} />
    </form>
  )
}

export function ActiveForm({ id, email, active }: { id: string; email: string; active: boolean }) {
  const [state, action] = useFormState<StaffState, FormData>(setActiveAction, {})
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(active ? `Deactivate ${email}? They lose access immediately.` : `Reactivate ${email}?`)) e.preventDefault() }} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <Submit label={active ? 'Deactivate' : 'Reactivate'} busy="…" />
      <Result state={state} />
    </form>
  )
}
