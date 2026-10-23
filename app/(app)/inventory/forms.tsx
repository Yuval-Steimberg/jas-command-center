'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormState } from 'react-dom'
import { Submit, input } from '../website/forms'
import type { ActionState } from './actions'
import { findBySkuAction } from './actions'

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>

export function Outcome({ state }: { state: ActionState }) {
  if (!state.message) return null
  return (
    <div role="status" className="flex flex-col gap-1">
      <p dir="auto" className={state.ok ? 'text-sm text-ok' : 'text-sm text-bad'}>{state.message}</p>
      {state.warning ? <p dir="auto" className="text-sm text-warn">{state.warning}</p> : null}
    </div>
  )
}

/**
 * One form per operation. `confirm` asks before submitting (money, stock and
 * anything that touches the website); the server re-checks everything anyway.
 */
export function ActionForm({
  action, hidden, children, label, busy, confirm, tone = 'plain', className,
}: {
  action: Action
  hidden: Record<string, string | number>
  children?: React.ReactNode
  label: string
  busy: string
  confirm?: string
  tone?: 'plain' | 'primary'
  className?: string
}) {
  const [state, run] = useFormState<ActionState, FormData>(action, {})
  return (
    <form
      action={run}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault()
      }}
      className={className ?? 'flex flex-col gap-2'}
    >
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <div><Submit label={label} busy={busy} tone={tone} /></div>
      <Outcome state={state} />
    </form>
  )
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      {children}
      {hint ? <span className="text-meta text-faint">{hint}</span> : null}
    </label>
  )
}

export function LocationSelect({ locations, defaultValue, name = 'locationId' }: { locations: { id: string; label: string }[]; defaultValue?: string | null; name?: string }) {
  return (
    <select name={name} defaultValue={defaultValue ?? ''} className={input}>
      <option value="">No location</option>
      {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
    </select>
  )
}

/** Pick a known customer, or (with crm:write) type a new one; the server matches by email or phone. */
export function ContactPicker({ contacts, allowNew, label = 'Customer' }: { contacts: { id: string; label: string }[]; allowNew: boolean; label?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Field label={label}>
        <select name="contactId" defaultValue="" className={input}>
          <option value="">{allowNew ? '— new or none —' : '— none —'}</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      {allowNew ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Not in the list? Add them</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <input name="newName" placeholder="Full name" dir="auto" maxLength={200} className={input} />
            <input name="newPhone" placeholder="Phone" dir="ltr" maxLength={40} className={input} />
            <input name="newEmail" placeholder="Email" dir="ltr" type="email" maxLength={200} className={input} />
          </div>
        </details>
      ) : null}
    </div>
  )
}

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}

/**
 * Scan a label: a USB / Bluetooth scanner types into the focused box and
 * presses Enter; a phone uses its camera where the browser has a barcode
 * detector (Chrome / Android). Typing the SKU always works.
 */
export function ScanBox() {
  const [state, run] = useFormState<ActionState, FormData>(findBySkuAction, {})
  const [camera, setCamera] = useState<'off' | 'on' | 'unsupported'>('off')
  const video = useRef<HTMLVideoElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const code = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (camera !== 'on') return
    const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      setCamera('unsupported')
      return
    }
    const detector = new Ctor({ formats: ['qr_code', 'code_128'] })
    let stream: MediaStream | null = null
    let stop = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        stream = s
        if (!video.current) return
        video.current.srcObject = s
        await video.current.play()
        while (!stop && video.current) {
          const found = await detector.detect(video.current).catch(() => [])
          if (found[0]?.rawValue && code.current && form.current) {
            code.current.value = found[0].rawValue
            form.current.requestSubmit()
            break
          }
          await new Promise((r) => setTimeout(r, 250))
        }
      })
      .catch(() => setCamera('unsupported'))
    return () => {
      stop = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [camera])

  return (
    <div className="flex flex-col gap-3">
      <form ref={form} action={run} className="flex flex-col gap-2 sm:flex-row">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Code</span>
          <input ref={code} name="code" autoFocus dir="ltr" placeholder="Scan or type a code, e.g. JAS-000123 or 123" maxLength={300} className={input} />
        </label>
        <Submit label="Open item" busy="Looking…" tone="primary" />
      </form>
      <Outcome state={state} />
      {camera === 'off' ? (
        <button type="button" onClick={() => setCamera('on')} className="h-10 self-start rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken">Use the camera</button>
      ) : camera === 'unsupported' ? (
        <p className="text-sm text-muted">This browser cannot read codes from the camera. Use a scanner or type the code.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <video ref={video} muted playsInline className="aspect-video w-full max-w-md rounded-md bg-forest object-cover" />
          <button type="button" onClick={() => setCamera('off')} className="h-10 self-start rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken">Stop the camera</button>
        </div>
      )}
    </div>
  )
}

/** Intake list: tick items, choose where they go, confirm. */
export function IntakeForm({ action, locations, children }: { action: Action; locations: { id: string; label: string }[]; children: React.ReactNode }) {
  const [state, run] = useFormState<ActionState, FormData>(action, {})
  return (
    <form action={run} className="flex flex-col gap-4">
      {children}
      <div className="grid gap-3 rounded-md border border-line/70 bg-ground/40 p-3 sm:grid-cols-3">
        <Field label="Put them in"><LocationSelect locations={locations} /></Field>
        <Field label="Condition" hint="Empty keeps what the crew recorded">
          <select name="condition" defaultValue="" className={input}>
            <option value="">As recorded in the field</option>
            <option value="as_new">As new</option>
            <option value="good">Good</option>
            <option value="needs_repair">Needs repair</option>
            <option value="scrap_only">Scrap only</option>
          </select>
        </Field>
        <Field label="Asking price (₪, optional)" hint="Same price for every ticked item"><input name="price" inputMode="decimal" dir="ltr" className={input} /></Field>
      </div>
      <div><Submit label="Confirm intake" busy="Taking in…" tone="primary" /></div>
      <Outcome state={state} />
    </form>
  )
}
