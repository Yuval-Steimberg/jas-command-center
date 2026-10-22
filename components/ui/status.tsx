import { CircleCheck, CircleAlert, CircleX, CircleHelp } from 'lucide-react'
import type { HealthStatus } from '@/lib/integrations/types'
import { cn } from '@/lib/cn'

// Colour + icon + word, always: colour alone fails for colour-blind readers and in sunlight.
const META: Record<HealthStatus, { label: string; cls: string; Icon: typeof CircleCheck }> = {
  operational: { label: 'Operational', cls: 'text-ok bg-ok/10 border-ok/25', Icon: CircleCheck },
  degraded: { label: 'Degraded', cls: 'text-warn bg-warn/10 border-warn/25', Icon: CircleAlert },
  down: { label: 'Down', cls: 'text-bad bg-bad/10 border-bad/25', Icon: CircleX },
  unknown: { label: 'Not checked', cls: 'text-muted bg-sunken border-line', Icon: CircleHelp },
}

export function StatusBadge({ status, className }: { status: HealthStatus; className?: string }) {
  const m = META[status]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', m.cls, className)}>
      <m.Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
      {m.label}
    </span>
  )
}

export function StatusDot({ status }: { status: HealthStatus }) {
  const m = META[status]
  return <m.Icon aria-label={m.label} className={cn('h-4 w-4', m.cls.split(' ')[0])} strokeWidth={2} />
}
