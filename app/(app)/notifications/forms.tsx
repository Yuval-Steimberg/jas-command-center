'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { assignAction, savePrefsAction, type AssignState, type PrefsState } from './actions'

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return <button disabled={pending} className="h-10 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken disabled:opacity-60">{pending ? '…' : label}</button>
}

export function AssignForm({ id, assignedTo, people }: { id: string; assignedTo: string | null; people: { id: string; label: string }[] }) {
  const [state, action] = useFormState<AssignState, FormData>(assignAction, {})
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-2">
        <label><span className="sr-only">Assign to</span>
          <select name="to" defaultValue={assignedTo ?? ''} className="h-10 max-w-[12rem] rounded-md border border-line bg-surface px-2 text-sm">
            <option value="">Nobody</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <Submit label="Assign" />
      </div>
      {state.message ? <p role="status" className={state.ok ? 'text-xs text-ok' : 'text-xs text-bad'}>{state.message}</p> : null}
    </form>
  )
}

type Opt = { id: string; label: string }
export function PrefsForm({ prefs, products, severities, emailAlerts, emailReports, emailReady }: {
  prefs: { mutedProducts: string[]; minSeverity: string; emailAlerts: string; emailReport: string }
  products: Opt[]; severities: Opt[]; emailAlerts: Opt[]; emailReports: Opt[]; emailReady: boolean
}) {
  const [state, action] = useFormState<PrefsState, FormData>(savePrefsAction, {})
  return (
    <form action={action} className="flex flex-col gap-5 text-sm">
      <fieldset>
        <legend className="mb-2 font-medium">Mute these products</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {products.map((p) => (
            <label key={p.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" name="muted" value={p.id} defaultChecked={prefs.mutedProducts.includes(p.id)} className="h-4 w-4" />{p.label}</label>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">Critical alerts always show and are always emailed if you get alert emails: they mean money or customers.</p>
      </fieldset>
      <label className="flex flex-col gap-1">Show alerts from
        <select name="minSeverity" defaultValue={prefs.minSeverity} className="h-10 w-56 rounded-md border border-line bg-surface px-2">{severities.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1">Email me when an alert opens
        <select name="emailAlerts" defaultValue={prefs.emailAlerts} className="h-10 w-56 rounded-md border border-line bg-surface px-2">{emailAlerts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1">Email me the business report
        <select name="emailReport" defaultValue={prefs.emailReport} className="h-10 w-56 rounded-md border border-line bg-surface px-2">{emailReports.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
      </label>
      {emailReady ? null : <p className="text-xs text-warn">Email is not set up on this deployment yet (SENDGRID_API_KEY, ALERT_EMAIL_FROM), so nothing is sent until it is. Your choice is kept.</p>}
      <div className="flex items-center gap-3"><Submit label="Save" />{state.message ? <span role="status" className={state.ok ? 'text-xs text-ok' : 'text-xs text-bad'}>{state.message}</span> : null}</div>
    </form>
  )
}
