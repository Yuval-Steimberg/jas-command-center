import Link from 'next/link'
import { CircleAlert, CircleX, Info } from 'lucide-react'
import type { Alert } from '@/lib/alerts'
import { cn } from '@/lib/cn'

const SEV = {
  critical: { Icon: CircleX, cls: 'text-bad', label: 'Critical' },
  warning: { Icon: CircleAlert, cls: 'text-warn', label: 'Warning' },
  info: { Icon: Info, cls: 'text-muted', label: 'Info' },
} as const

export function AlertsList({ alerts, limit }: { alerts: Alert[]; limit?: number }) {
  const shown = limit ? alerts.slice(0, limit) : alerts
  if (!alerts.length)
    return <p className="py-2 text-sm text-muted">Nothing needs attention in the systems that are connected. Systems that are not connected are not checked — see Integrations.</p>
  return (
    <ul className="divide-y divide-line/70">
      {shown.map((a) => {
        const s = SEV[a.severity]
        return (
          <li key={a.id}>
            <Link href={a.href} className="-mx-2 flex gap-3 rounded-md px-2 py-2.5 hover:bg-sunken/60">
              <s.Icon aria-label={s.label} className={cn('mt-0.5 h-4 w-4 shrink-0', s.cls)} strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <div className="break-words text-sm font-medium text-ink">{a.title}</div>
                {a.detail ? <div className="truncate text-xs text-muted">{a.detail}</div> : null}
              </div>
            </Link>
          </li>
        )
      })}
      {limit && alerts.length > limit ? (
        <li className="pt-2 text-xs">
          <Link href="/notifications" className="text-muted underline-offset-2 hover:underline">
            {alerts.length - limit} more
          </Link>
        </li>
      ) : null}
    </ul>
  )
}
