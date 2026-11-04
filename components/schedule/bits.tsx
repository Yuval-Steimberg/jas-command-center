import type { DayView } from '@/lib/volunteers/schedule'

/** The one line that says how the day stands: colour AND words, so it reads in sunlight and without colour. */
export function DayStatus({ d, past, big }: { d: DayView; past?: boolean; big?: boolean }) {
  const size = big ? 'text-2xl' : 'text-xl'
  if (d.closed) return <p className={`${size} font-bold text-muted`}>סגור{d.closed.reason ? ` · ${d.closed.reason}` : ''}</p>
  if (d.required === null) return <p className={`${size} font-bold text-muted`}>לא נקבע יעד <span className="text-sm font-medium">· {d.coming} מגיעים</span></p>
  if (d.missing) return <p className={`${size} font-bold ${past ? 'text-muted' : 'text-warn'}`}>{past ? `חסרו ${d.missing}` : `חסרים ${d.missing}`}</p>
  return <p className={`${size} font-bold text-ok`}>מאויש{d.surplus ? ` · +${d.surplus}` : ''}</p>
}

export function Stat({ label, value, tone, hint }: { label: string; value: number | null; tone?: 'warn' | 'strong'; hint?: string }) {
  return (
    <div className="rounded-md bg-sunken/60 px-2 py-1.5 text-center">
      <dt className="text-meta text-muted">{label}</dt>
      <dd className={`num text-lg font-bold ${tone === 'warn' ? 'text-warn' : tone === 'strong' ? 'text-forest' : 'text-ink'}`}>
        {value === null ? '—' : value}
        {hint ? <span className="ms-1 text-xs font-medium text-muted">{hint}</span> : null}
      </dd>
    </div>
  )
}

export function Phone({ phone }: { phone: string | null }) {
  if (!phone) return null
  return <a href={`tel:${phone}`} dir="ltr" className="num inline-flex min-h-9 items-center rounded-full border border-line px-3 text-xs font-medium text-ink hover:bg-sunken">{phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3')}</a>
}

export function Section({ title, count, children, tone }: { title: string; count?: number; children: React.ReactNode; tone?: 'warn' }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className={`text-base font-bold ${tone === 'warn' ? 'text-warn' : 'text-ink'}`}>{title}{count !== undefined ? <span className="num ms-1 text-muted">({count})</span> : null}</h2>
      {children}
    </section>
  )
}

export const rowCls = 'flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5'
export const empty = (t: string) => <p className="rounded-lg border border-dashed border-line px-4 py-3 text-center text-sm text-muted">{t}</p>
