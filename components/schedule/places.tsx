import type { SchedLocation } from '@/lib/volunteers/schedule'

/**
 * The places this person may open, as one row of chips (shown only with more
 * than one: Dafna coordinates every place). The open one is sage, like the
 * active tab in shop mode; switching opens that place's week.
 */
export function PlaceSwitcher({ locations, current }: { locations: SchedLocation[]; current: string }) {
  if (locations.length < 2) return null
  return (
    <nav aria-label="מקום" className="mb-4">
      <ul className="flex flex-wrap gap-2">
        {locations.map((l) => {
          const on = l.id === current
          return (
            <li key={l.id}>
              {/* A full page load (not a client route change), so the layout re-reads the place cookie. */}
              <a
                href={`/schedule/place?id=${encodeURIComponent(l.id)}&next=/schedule`}
                aria-current={on ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-semibold ${on ? 'border-sage bg-sage text-forest' : 'border-line bg-surface text-ink hover:bg-sunken'}`}
              >
                {l.name}
                {l.access === 'view' ? <span className="text-xs font-normal text-muted">· צפייה</span> : null}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
