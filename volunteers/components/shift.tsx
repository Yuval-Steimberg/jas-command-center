import Link from 'next/link'
import { CalendarDays, MapPin, Users } from 'lucide-react'
import { KIND_HE } from '@shared/volunteers/model'
import type { ShiftView } from '@shared/volunteers/views'
import { placeHe, placesHe, relativeDayHe, whenHe } from '@/lib/format'
import { Pill } from './ui'

/** One activity on the explore list: what, when (its next shift), where, how many places. */
export function ActivityCard({ views, href }: { views: ShiftView[]; href: string }) {
  const first = views[0]!
  const a = first.activity
  const open = views.filter((v) => v.phase === 'open')
  const places = open.reduce((n, v) => n + v.places, 0)
  const rel = relativeDayHe(first.shift.startsAt)
  return (
    <Link href={href} className="group block min-w-0 rounded-lg border border-line bg-paper p-4 shadow-1 transition duration-200 ease-standard hover:-translate-y-px hover:shadow-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate">{KIND_HE[a.kind]}</p>
          <h3 className="mt-0.5 text-lg font-bold leading-snug text-forest">{a.title}</h3>
        </div>
        {rel ? <Pill tone="sage">{rel}</Pill> : null}
      </div>
      {a.summary ? <p className="mt-2 line-clamp-2 text-base leading-relaxed text-slate">{a.summary}</p> : null}
      <ul className="mt-3 space-y-1.5 text-base text-ink">
        <li className="flex items-center gap-2"><CalendarDays aria-hidden className="h-[1.125rem] w-[1.125rem] shrink-0 text-slate" strokeWidth={1.75} /><span>{whenHe(first.shift)}{views.length > 1 ? <span className="text-slate"> · ועוד {views.length - 1} משמרות</span> : null}</span></li>
        <li className="flex items-center gap-2"><MapPin aria-hidden className="h-[1.125rem] w-[1.125rem] shrink-0 text-slate" strokeWidth={1.75} /><span className="min-w-0 truncate">{placeHe(a)}</span></li>
        <li className="flex items-center gap-2"><Users aria-hidden className="h-[1.125rem] w-[1.125rem] shrink-0 text-slate" strokeWidth={1.75} />
          {open.length ? <span className="font-semibold text-ok">{places === 1 ? 'מקום אחד פנוי' : `${places} מקומות פנויים`}</span> : <span className="text-warn">{placesHe(first).text}</span>}
        </li>
      </ul>
      {a.adultsOnly ? <p className="mt-2 text-sm text-slate">מגיל 18</p> : null}
    </Link>
  )
}

/** Group shift views by activity, keeping the order of each activity's first shift. */
export function byActivity(views: ShiftView[]): ShiftView[][] {
  const m = new Map<string, ShiftView[]>()
  for (const v of views) m.set(v.activity.id, [...(m.get(v.activity.id) ?? []), v])
  return [...m.values()]
}
