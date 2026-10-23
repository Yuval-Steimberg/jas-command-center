import { input } from '@/app/(app)/website/forms'
import { Field } from '@/app/(app)/inventory/forms'
import { CONTACT_ROLES, type Contact } from '@/lib/ops/types'
import { ROLE_LABEL } from '@/lib/crm/model'

/** The contact form's fields, shared by /crm/new and the contact page's edit form. */
export function ContactFields({ c }: { c?: Contact }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Full name"><input name="fullName" required defaultValue={c?.fullName} dir="auto" maxLength={200} className={input} /></Field>
      <Field label="Person or company">
        <select name="kind" defaultValue={c?.kind ?? 'person'} className={input}>
          <option value="person">Person</option>
          <option value="company">Company / organisation</option>
        </select>
      </Field>
      <Field label="Phone" hint="Israeli numbers in any format"><input name="phone" defaultValue={c?.phone ?? ''} dir="ltr" maxLength={40} className={input} /></Field>
      <Field label="Email"><input name="email" type="email" defaultValue={c?.email ?? ''} dir="ltr" maxLength={200} className={input} /></Field>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-sm text-muted">Roles</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {CONTACT_ROLES.map((r) => (
            <label key={r} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="roles" value={r} defaultChecked={c ? c.roles.includes(r) : r === 'lead'} className="h-4 w-4" /> {ROLE_LABEL[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2"><Field label="Notes"><textarea name="notes" defaultValue={c?.notes ?? ''} dir="auto" maxLength={2000} rows={3} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" /></Field></div>
    </div>
  )
}
