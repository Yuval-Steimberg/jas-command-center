'use client'

import { useState, useTransition } from 'react'
import type { ActResult } from '@/lib/schedule/act'
import { addRegularAction, setClosureAction, setHoursAction, setRequiredAction } from '@/app/schedule/actions'

function Result({ res }: { res: ActResult | null }) {
  if (!res) return null
  return <span role={res.ok ? 'status' : 'alert'} className={`text-xs ${res.ok ? 'text-ok' : 'text-bad'}`}>{res.message}</span>
}

function useAct() {
  const [pending, start] = useTransition()
  const [res, setRes] = useState<ActResult | null>(null)
  const run = (fn: () => Promise<ActResult>) => {
    setRes(null)
    start(async () => setRes(await fn().catch(() => ({ ok: false, message: 'הבקשה נכשלה. נא לרענן ולבדוק.' }))))
  }
  return { pending, res, run }
}

const field = 'h-11 rounded-md border border-line bg-surface px-3 text-ink'
const btn = 'inline-flex min-h-11 items-center justify-center rounded-full bg-forest px-4 text-sm font-semibold text-cream hover:bg-forest/90 disabled:opacity-60'

/** How many volunteers this weekday needs, every week. Blank = not set (shown as "not set", never as 0). */
export function RequiredForm({ slotId, version, required }: { slotId: string; version: number; required: number | null }) {
  const [v, setV] = useState(required === null ? '' : String(required))
  const { pending, res, run } = useAct()
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setRequiredAction({ slotId, version, required: v.trim() === '' ? null : Number(v) })) }}>
      <label className="text-sm font-medium text-ink" htmlFor={`req-${slotId}`}>נדרשים כל שבוע</label>
      <input id={`req-${slotId}`} inputMode="numeric" pattern="[0-9]*" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="לא נקבע" className={`${field} w-24 text-center`} />
      <button type="submit" disabled={pending} className={btn}>{pending ? 'שומר…' : 'שמירה'}</button>
      <Result res={res} />
    </form>
  )
}

export function HoursForm({ slotId, version, startsAt, endsAt }: { slotId: string; version: number; startsAt: string | null; endsAt: string | null }) {
  const [a, setA] = useState(startsAt?.slice(0, 5) ?? '')
  const [b, setB] = useState(endsAt?.slice(0, 5) ?? '')
  const { pending, res, run } = useAct()
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setHoursAction({ slotId, version, startsAt: a || null, endsAt: b || null })) }}>
      <span className="text-sm font-medium text-ink">שעות</span>
      <input type="time" aria-label="משעה" value={a} onChange={(e) => setA(e.target.value)} className={`${field} w-32`} dir="ltr" />
      <span aria-hidden>–</span>
      <input type="time" aria-label="עד שעה" value={b} onChange={(e) => setB(e.target.value)} className={`${field} w-32`} dir="ltr" />
      <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold text-ink hover:bg-sunken disabled:opacity-60">{pending ? 'שומר…' : 'שמירה'}</button>
      <Result res={res} />
    </form>
  )
}

/** Add a volunteer to this weekday's regulars from a date. The picker lists only people who are not regulars here yet. */
export function AddRegularForm({ slotId, options, today }: { slotId: string; options: { id: string; name: string }[]; today: string }) {
  const [vid, setVid] = useState('')
  const [from, setFrom] = useState(today)
  const [q, setQ] = useState('')
  const { pending, res, run } = useAct()
  const shown = q.trim() ? options.filter((o) => o.name.includes(q.trim())) : options
  return (
    <form className="flex flex-col gap-2 rounded-lg border border-dashed border-line p-3" onSubmit={(e) => { e.preventDefault(); if (vid) run(async () => { const r = await addRegularAction({ slotId, volunteerId: vid, from }); if (r.ok) { setVid(''); setQ('') } return r }) }}>
      <span className="text-sm font-semibold text-ink">הוספת קבוע/ה</span>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם" aria-label="חיפוש מתנדב/ת" className={field} />
      <select value={vid} onChange={(e) => setVid(e.target.value)} aria-label="מתנדב/ת" className={field} required>
        <option value="">בחירת מתנדב/ת ({shown.length})</option>
        {shown.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted" htmlFor={`from-${slotId}`}>החל מ-</label>
        <input id={`from-${slotId}`} type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} className={`${field} w-44`} dir="ltr" />
        <button type="submit" disabled={pending || !vid} className={btn}>{pending ? 'מוסיף…' : 'הוספה'}</button>
      </div>
      <Result res={res} />
    </form>
  )
}

/** A holiday or any day the workshop does not open: nobody is expected, nothing is missing. */
export function ClosureForm({ slotId, date, closed }: { slotId: string; date: string; closed: { reason: string | null } | null }) {
  const [reason, setReason] = useState('')
  const [open, setOpen] = useState(false)
  const { pending, res, run } = useAct()
  if (closed) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={() => run(() => setClosureAction({ slotId, date, closed: false }))} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold text-ink hover:bg-sunken disabled:opacity-60">{pending ? 'רגע…' : 'הסדנה כן פתוחה ביום הזה'}</button>
        <Result res={res} />
      </div>
    )
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="self-start text-sm font-medium text-muted underline underline-offset-4">הסדנה סגורה ביום הזה (חג, אירוע)…</button>
  return (
    <form className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3" onSubmit={(e) => { e.preventDefault(); if (window.confirm('לסמן שהסדנה סגורה? אף אחד לא ייספר כחסר, והמתנדבים יראו שהיום סגור.')) run(() => setClosureAction({ slotId, date, closed: true, reason: reason || null })) }}>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="סיבה (לא חובה), למשל: חג" maxLength={200} aria-label="סיבה" className={`${field} flex-1`} />
      <button type="submit" disabled={pending} className={btn}>{pending ? 'שומר…' : 'סימון כסגור'}</button>
      <Result res={res} />
    </form>
  )
}
