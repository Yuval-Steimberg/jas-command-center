import type { Capability } from '@/lib/integrations/types'
import { cn } from '@/lib/cn'

const LABEL: Record<Capability['status'], { text: string; cls: string }> = {
  available: { text: 'Available', cls: 'bg-ok/10 text-ok border-ok/25' },
  needs_credentials: { text: 'Needs credentials', cls: 'bg-warn/10 text-warn border-warn/25' },
  needs_source_change: { text: 'Needs source change', cls: 'bg-warn/10 text-warn border-warn/25' },
  not_built: { text: 'Not built yet', cls: 'bg-sunken text-muted border-line' },
  unsupported: { text: 'Not supported', cls: 'bg-sunken text-muted border-line' },
}

export function CapabilityList({ items }: { items: Capability[] }) {
  return (
    <ul className="divide-y divide-line/70">
      {items.map((c) => (
        <li key={c.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="text-sm text-ink">
              {c.label} <span className="text-meta uppercase tracking-wide text-faint">· {c.kind}</span>
            </div>
            {c.note ? <div className="text-xs text-muted">{c.note}</div> : null}
          </div>
          <span className={cn('w-fit shrink-0 rounded-full border px-2 py-0.5 text-meta font-medium', LABEL[c.status].cls)}>{LABEL[c.status].text}</span>
        </li>
      ))}
    </ul>
  )
}
