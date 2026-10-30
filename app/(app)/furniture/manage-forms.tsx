'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  addApartmentAction, addItemsAction, addPhotoAction, buildingAction, bulkItemsAction, createProjectAction, deleteApartmentAction,
  deleteItemAction, describePhotoAction, editApartmentAction, editItemAction, editProjectAction, memberAction, type OpState,
} from './manage-actions'

type Opt = { id: string; label: string }
type Dest = { id: string; galleryType: string; label: string }

const input = 'h-10 rounded-md border border-line bg-surface px-2 text-sm'
const area = 'min-h-24 rounded-md border border-line bg-surface p-2 text-sm'

function Submit({ label, busy = 'Saving…', tone }: { label: string; busy?: string; tone?: 'bad' }) {
  const { pending } = useFormStatus()
  return (
    <button disabled={pending} className={`h-10 w-fit rounded-full border px-4 text-sm font-medium disabled:opacity-60 ${tone === 'bad' ? 'border-bad/40 text-bad hover:bg-bad/5' : 'border-line hover:bg-sunken'}`}>
      {pending ? busy : label}
    </button>
  )
}

function Result({ state }: { state: OpState }) {
  if (!state.message) return null
  return <p role="status" dir="auto" className={state.ok ? 'text-xs text-ok' : 'text-xs text-bad'}>{state.message}</p>
}

function Hidden({ values }: { values: Record<string, string> }) {
  return <>{Object.entries(values).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>
}

/** Reset a form after a success, so the next entry starts empty. */
function useResetOnSuccess(state: OpState) {
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (state.ok) ref.current?.reset()
  }, [state.ok, state.at])
  return ref
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-muted ${wide ? 'sm:col-span-2' : ''}`}>
      <span dir="auto">{label}</span>
      {children}
    </label>
  )
}

function DestSelect({ destinations, name = 'galleryType', defaultValue }: { destinations: Dest[]; name?: string; defaultValue?: string }) {
  return (
    <select name={name} defaultValue={defaultValue ?? destinations[0]?.galleryType} className={input} dir="rtl">
      {destinations.map((d) => <option key={d.id} value={d.galleryType}>{d.label}</option>)}
    </select>
  )
}

// ── Items ────────────────────────────────────────────────────────────────

/** A typed list, one item per line (or free text): the field app's AI splits it, as in the app's typed entry. */
export function AddItemsForm({ projectId, apartmentId, destinations }: { projectId: string; apartmentId: string; destinations: Dest[] }) {
  const [state, action] = useFormState<OpState, FormData>(addItemsAction, {})
  const ref = useResetOnSuccess(state)
  return (
    <form ref={ref} action={action} className="flex flex-col gap-2">
      <Hidden values={{ projectId, apartmentId }} />
      <label className="flex flex-col gap-1 text-xs text-muted">
        <span>Add items by typing (one per line, or describe the room)</span>
        <textarea name="text" required maxLength={20000} dir="auto" className={area} placeholder={'ספה תלת מושבית\nשולחן אוכל עץ\n2 כיסאות'} />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Group"><DestSelect destinations={destinations} /></Field>
        <Submit label="Add items" busy="Adding…" />
      </div>
      <Result state={state} />
    </form>
  )
}

const MAX_EDGE = 1600

/** JPEG on the device: the field app's vision model reads JPEG, and a phone photo is far over the upload limit. */
async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8))
  if (!blob) throw new Error('This browser could not prepare the photo.')
  return blob
}

/**
 * Photos into the field app. Without `itemId` each photo becomes a new item
 * (placeholder description, then the field app's AI describes it); with one,
 * the photos are added to that item.
 */
export function PhotoForm({ projectId, apartmentId, destinations, itemId, updatedAt }: { projectId: string; apartmentId: string; destinations?: Dest[]; itemId?: string; updatedAt?: string }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [group, setGroup] = useState(destinations?.[0]?.galleryType ?? '')
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState<{ ok: boolean; text: string }[]>([])
  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setLines([])
    try {
      // One at a time onto an existing item (multiple is off there): each attach changes its updated_at.
      for (const [n, file] of Array.from(files).entries()) {
        const label = files.length > 1 ? `Photo ${n + 1}: ` : ''
        try {
          const f = new FormData()
          f.set('projectId', projectId)
          f.set('apartmentId', apartmentId)
          if (itemId) {
            f.set('itemId', itemId)
            f.set('expectUpdatedAt', updatedAt ?? '')
          } else f.set('galleryType', group)
          f.set('file', await toJpeg(file), 'photo.jpg')
          const r = await addPhotoAction(f)
          setLines((l) => [...l, { ok: Boolean(r.ok), text: label + (r.message ?? '') }])
          if (!r.ok) continue
          if (!itemId && r.id) {
            const d = await describePhotoAction(projectId, r.id)
            setLines((l) => [...l, { ok: Boolean(d.ok), text: label + (d.message ?? '') }])
          }
        } catch (e) {
          setLines((l) => [...l, { ok: false, text: label + (e instanceof Error ? e.message : String(e)) }])
        }
      }
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
      router.refresh()
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        {destinations && !itemId ? (
          <Field label="Group">
            <select value={group} onChange={(e) => setGroup(e.target.value)} className={input} dir="rtl">
              {destinations.map((d) => <option key={d.id} value={d.galleryType}>{d.label}</option>)}
            </select>
          </Field>
        ) : null}
        <input ref={fileRef} type="file" accept="image/*" multiple={!itemId} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void upload(e.target.files)} />
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="h-10 w-fit rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken disabled:opacity-60">
          {busy ? 'Uploading…' : itemId ? 'Add a photo' : 'Add items from photos'}
        </button>
      </div>
      {lines.map((l, i) => <p key={i} role="status" dir="auto" className={l.ok ? 'text-xs text-ok' : 'text-xs text-bad'}>{l.text}</p>)}
    </div>
  )
}

/** The bar under an apartment's item list: the checkboxes on each item belong to this form. */
export function BulkItemsBar({ formId, projectId, destinations, canDelete }: { formId: string; projectId: string; destinations: Dest[]; canDelete: boolean }) {
  const [state, action] = useFormState<OpState, FormData>(bulkItemsAction, {})
  return (
    <form
      id={formId}
      action={action}
      onSubmit={(e) => {
        const f = new FormData(e.currentTarget)
        const n = f.getAll('itemIds').length
        const todo = String(f.get('todo'))
        const what = todo === 'delete' ? `Delete ${n} item${n === 1 ? '' : 's'}? Their rows are removed from the field app.` : `Move ${n} item${n === 1 ? '' : 's'} to ${destinations.find((d) => `move:${d.id}` === todo)?.label}?`
        if (!n || !window.confirm(what)) e.preventDefault()
      }}
      className="flex flex-wrap items-center gap-2 border-t border-line/50 pt-2"
    >
      <Hidden values={{ projectId }} />
      <span className="text-xs text-muted">Ticked items:</span>
      <select name="todo" className={input} dir="rtl" defaultValue={`move:${destinations[0]?.id ?? ''}`}>
        {destinations.map((d) => <option key={d.id} value={`move:${d.id}`}>העבר ל{d.label}</option>)}
        {canDelete ? <option value="delete">מחק</option> : null}
      </select>
      <Submit label="Apply" busy="…" />
      <Result state={state} />
    </form>
  )
}

export function ItemEditForm({ projectId, item, options }: {
  projectId: string
  item: Record<string, unknown> & { id: string; updated_at: string }
  options: { destinations: Dest[]; itemTypes: Opt[]; materials: Opt[]; conditions: Opt[]; difficulties: Opt[]; categories: string[] }
}) {
  const [state, action] = useFormState<OpState, FormData>(editItemAction, {})
  const v = (k: string) => (item[k] == null ? '' : String(item[k]))
  const sel = (name: string, opts: Opt[], blank: boolean) => (
    <select name={name} defaultValue={v(name)} className={input} dir="rtl">
      {blank ? <option value="">—</option> : null}
      {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  )
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <Hidden values={{ id: item.id, projectId, expectUpdatedAt: item.updated_at }} />
      <Field label="תיאור" wide><input name="description" required maxLength={500} defaultValue={v('description')} dir="auto" className={input} /></Field>
      <Field label="כמות"><input name="quantity" type="number" min={1} max={999} defaultValue={v('quantity') || '1'} className={input} /></Field>
      <Field label="מיקום"><input name="location" maxLength={100} defaultValue={v('location')} dir="auto" className={input} /></Field>
      <Field label="קבוצה"><DestSelect name="gallery_type" destinations={options.destinations} defaultValue={v('gallery_type')} /></Field>
      <Field label="קטגוריה">
        <select name="item_category" defaultValue={v('item_category')} className={input} dir="rtl">
          <option value="">—</option>
          {[...new Set([...options.categories, ...(v('item_category') ? [v('item_category')] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="סוג">{sel('item_type', options.itemTypes, false)}</Field>
      <Field label="חומר">{sel('material_category', options.materials, false)}</Field>
      <Field label="מצב הפריט">{sel('condition', options.conditions, true)}</Field>
      <Field label="קושי פירוק">{sel('dismantle_difficulty', options.difficulties, true)}</Field>
      <Field label="מידות"><input name="dimensions" maxLength={100} defaultValue={v('dimensions')} dir="auto" className={input} /></Field>
      <Field label="משקל משוער (ק״ג)"><input name="estimated_weight_kg" type="number" min={0} step="0.1" defaultValue={v('estimated_weight_kg')} className={input} /></Field>
      <Field label="הערות" wide><textarea name="notes" maxLength={2000} defaultValue={v('notes')} dir="auto" className={area} /></Field>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Submit label="Save item" />
        <Result state={state} />
      </div>
    </form>
  )
}

export function DeleteItemForm({ id, projectId, label, backHref }: { id: string; projectId: string; label: string; backHref: string }) {
  const [state, action] = useFormState<OpState, FormData>(deleteItemAction, {})
  const router = useRouter()
  useEffect(() => {
    if (state.ok) router.push(backHref)
  }, [state.ok, backHref, router])
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(`Delete "${label}" from the field app? This cannot be undone.`)) e.preventDefault() }} className="flex flex-col gap-1">
      <Hidden values={{ id, projectId, label }} />
      <Submit label="Delete item" busy="Deleting…" tone="bad" />
      <Result state={state} />
    </form>
  )
}

// ── Apartments and buildings ─────────────────────────────────────────────

export function EditApartmentForm({ projectId, apartment, label, canDelete }: { projectId: string; apartment: { id: string; apartment_number: string | null; entrance?: string | null; notes?: unknown; updated_at: string | null }; label: string; canDelete: boolean }) {
  const [state, action] = useFormState<OpState, FormData>(editApartmentAction, {})
  const [delState, del] = useFormState<OpState, FormData>(deleteApartmentAction, {})
  return (
    <details className="rounded-md border border-line/70 p-2">
      <summary className="cursor-pointer text-sm">Edit apartment</summary>
      <form action={action} className="mt-2 grid gap-2 sm:grid-cols-3">
        <Hidden values={{ id: apartment.id, projectId, expectUpdatedAt: apartment.updated_at ?? '' }} />
        <Field label="מספר / שם הדירה"><input name="number" required maxLength={40} defaultValue={apartment.apartment_number ?? ''} dir="auto" className={input} /></Field>
        <Field label="כניסה"><input name="entrance" maxLength={20} defaultValue={apartment.entrance ?? ''} dir="auto" className={input} /></Field>
        <Field label="הערות" wide><textarea name="notes" maxLength={2000} defaultValue={typeof apartment.notes === 'string' ? apartment.notes : ''} dir="auto" className={area} /></Field>
        <div className="flex flex-col gap-1 sm:col-span-3"><Submit label="Save apartment" /><Result state={state} /></div>
      </form>
      {canDelete ? (
        <form action={del} onSubmit={(e) => { if (!window.confirm(`Delete ${label}? Only an empty apartment can be deleted.`)) e.preventDefault() }} className="mt-2 flex flex-col gap-1">
          <Hidden values={{ id: apartment.id, projectId, label }} />
          <Submit label="Delete apartment" busy="Deleting…" tone="bad" />
          <Result state={delState} />
        </form>
      ) : null}
    </details>
  )
}

export function AddApartmentForm({ projectId, buildings }: { projectId: string; buildings: string[] }) {
  const [state, action] = useFormState<OpState, FormData>(addApartmentAction, {})
  const ref = useResetOnSuccess(state)
  return (
    <form ref={ref} action={action} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <Hidden values={{ projectId }} />
      <Field label="בניין">
        <input name="building" required maxLength={40} list={`buildings-${projectId}`} defaultValue={buildings[0] ?? ''} dir="auto" className={input} />
        <datalist id={`buildings-${projectId}`}>{buildings.map((b) => <option key={b} value={b} />)}</datalist>
      </Field>
      <Field label="כניסה (אם יש יותר מאחת)"><input name="entrance" maxLength={20} dir="auto" className={input} /></Field>
      <Field label="מספר דירה"><input name="number" required maxLength={40} dir="auto" className={input} /></Field>
      <Submit label="Add apartment" busy="Adding…" />
      <div className="sm:col-span-4"><Result state={state} /></div>
    </form>
  )
}

export function BuildingControls({ projectId, building }: { projectId: string; building: string }) {
  const [state, action] = useFormState<OpState, FormData>(buildingAction, {})
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted">Building settings</summary>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <form action={action} className="flex items-end gap-2">
          <Hidden values={{ projectId, todo: 'rename', from: building }} />
          <Field label="שם / מספר חדש"><input name="to" required maxLength={40} defaultValue={building} dir="auto" className={`${input} w-28`} /></Field>
          <Submit label="Rename" busy="…" />
        </form>
        <form action={action} onSubmit={(e) => { if (!window.confirm(`Delete building ${building} with all of its apartments? Only allowed when none of them has items.`)) e.preventDefault() }}>
          <Hidden values={{ projectId, todo: 'delete', from: building }} />
          <Submit label="Delete building" busy="…" tone="bad" />
        </form>
      </div>
      <Result state={state} />
    </details>
  )
}

export function AddBuildingForm({ projectId }: { projectId: string }) {
  const [state, action] = useFormState<OpState, FormData>(buildingAction, {})
  const ref = useResetOnSuccess(state)
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
      <Hidden values={{ projectId, todo: 'add' }} />
      <Field label="בניין חדש (מספר)"><input name="to" required maxLength={40} dir="auto" className={`${input} w-32`} /></Field>
      <Submit label="Add building" busy="…" />
      <Result state={state} />
    </form>
  )
}

// ── Projects ─────────────────────────────────────────────────────────────

type IdentityField = { key: string; label: string; type: 'text' | 'number' | 'date' | 'multiline'; section: string }

function IdentityFields({ fields, values, only }: { fields: IdentityField[]; values: Record<string, string>; only?: (f: IdentityField) => boolean }) {
  const sections = [...new Set(fields.filter((f) => !only || only(f)).map((f) => f.section))]
  return (
    <>
      {sections.map((s) => (
        <fieldset key={s} className="grid gap-3 sm:grid-cols-2">
          <legend dir="rtl" className="mb-1 text-sm font-semibold">{s}</legend>
          {fields.filter((f) => f.section === s && (!only || only(f))).map((f) => (
            <Field key={f.key} label={f.label} wide={f.type === 'multiline'}>
              {f.type === 'multiline'
                ? <textarea name={`identity.${f.key}`} defaultValue={values[f.key] ?? ''} maxLength={4000} dir="auto" className={area} />
                : <input name={`identity.${f.key}`} type={f.type} defaultValue={values[f.key] ?? ''} required={f.key === 'name'} dir="auto" className={input} />}
            </Field>
          ))}
        </fieldset>
      ))}
    </>
  )
}

export function EditProjectForm({ projectId, fields, values }: { projectId: string; fields: IdentityField[]; values: Record<string, string> }) {
  const [state, action] = useFormState<OpState, FormData>(editProjectAction, {})
  return (
    <form action={action} className="flex flex-col gap-5">
      <Hidden values={{ projectId }} />
      <IdentityFields fields={fields} values={values} />
      <div className="flex flex-col gap-1"><Submit label="Save project card" /><Result state={state} /></div>
    </form>
  )
}

/**
 * A new project opens with its whole skeleton, as in the field app: every
 * building and every apartment, empty and waiting to be mapped. The plan is
 * shown before anything is created.
 */
export function NewProjectForm({ fields, maxBuildings, maxPerEntrance }: { fields: IdentityField[]; maxBuildings: number; maxPerEntrance: number }) {
  const [state, action] = useFormState<OpState, FormData>(createProjectAction, {})
  const router = useRouter()
  const [entrances, setEntrances] = useState(1)
  const [rows, setRows] = useState([{ n: '1', a: 0 }])
  useEffect(() => {
    if (state.ok && state.id) router.push(`/furniture/${state.id}`)
  }, [state.ok, state.id, router])
  const total = rows.reduce((t, r) => t + (r.a || 0) * Math.max(1, entrances), 0)
  return (
    <form action={action} className="flex flex-col gap-5">
      <IdentityFields fields={fields} values={{}} only={(f) => ['זיהוי', 'מיקום'].includes(f.section) && f.key !== 'entrance_count' && f.key !== 'building_count'} />
      <fieldset className="flex flex-col gap-3">
        <legend dir="rtl" className="mb-1 text-sm font-semibold">מבנה הפרויקט</legend>
        <Field label="מספר כניסות בכל בניין">
          <input name="identity.entrance_count" type="number" min={1} max={9} value={entrances} onChange={(e) => setEntrances(Math.max(1, Number(e.target.value) || 1))} className={`${input} w-24`} />
        </Field>
        <input type="hidden" name="identity.building_count" value={String(rows.length)} />
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <Field label={`בניין ${i + 1} — מספר`}>
              <input name="building_number" required maxLength={40} value={r.n} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, n: e.target.value } : x)))} dir="auto" className={`${input} w-28`} />
            </Field>
            <Field label={entrances > 1 ? 'דירות בכל כניסה' : 'דירות בבניין'}>
              <input name="building_apartments" type="number" min={0} max={maxPerEntrance} value={r.a} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, a: Number(e.target.value) || 0 } : x)))} className={`${input} w-24`} />
            </Field>
            {rows.length > 1 ? <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="h-10 rounded-full border border-line px-3 text-xs hover:bg-sunken">Remove</button> : null}
          </div>
        ))}
        {rows.length < maxBuildings ? (
          <button type="button" onClick={() => setRows([...rows, { n: String(rows.length + 1), a: rows.at(-1)?.a ?? 0 }])} className="h-10 w-fit rounded-full border border-line px-4 text-sm hover:bg-sunken">Add a building</button>
        ) : null}
        <p dir="rtl" className="text-sm">ייפתחו {rows.length} בניינים ו-{total} דירות.</p>
      </fieldset>
      <div className="flex flex-col gap-1"><Submit label="Create project" busy="Creating…" /><Result state={state} /></div>
    </form>
  )
}

// ── Members ──────────────────────────────────────────────────────────────

export function AddMemberForm({ projectId, candidates, roles }: { projectId: string; candidates: { userId: string; name: string; email: string | null }[]; roles: Opt[] }) {
  const [state, action] = useFormState<OpState, FormData>(memberAction, {})
  if (!candidates.length) return <p className="text-sm text-muted">Everyone with a field-app account is already on this project. New accounts are created in the field app’s user management.</p>
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Hidden values={{ projectId, todo: 'add' }} />
      <Field label="Person">
        <select name="userId" required className={input} dir="auto">
          {candidates.map((c) => <option key={c.userId} value={c.userId}>{c.name}{c.email ? ` (${c.email})` : ''}</option>)}
        </select>
      </Field>
      <Field label="Role">
        <select name="role" defaultValue="WORKER" className={input} dir="rtl">{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
      </Field>
      <Submit label="Add to project" busy="…" />
      <Result state={state} />
    </form>
  )
}

export function MemberRow({ projectId, member, roles }: { projectId: string; member: { userId: string; role: string; name: string | null; email: string | null }; roles: Opt[] }) {
  const [state, action] = useFormState<OpState, FormData>(memberAction, {})
  const label = member.name ?? member.email ?? 'This person'
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex flex-wrap items-end gap-2">
        <span className="min-w-40 text-sm" dir="auto">{label}{member.email && member.name ? <span className="text-xs text-muted"> · {member.email}</span> : null}</span>
        <form action={action} className="flex items-end gap-2">
          <Hidden values={{ projectId, userId: member.userId, todo: 'role' }} />
          <select name="role" defaultValue={member.role} className={input} dir="rtl" aria-label="Role">{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
          <Submit label="Change role" busy="…" />
        </form>
        <form action={action} onSubmit={(e) => { if (!window.confirm(`Remove ${label} from this project? They lose access to it in the field app.`)) e.preventDefault() }}>
          <Hidden values={{ projectId, userId: member.userId, todo: 'remove', label }} />
          <Submit label="Remove" busy="…" tone="bad" />
        </form>
      </div>
      <Result state={state} />
    </div>
  )
}
