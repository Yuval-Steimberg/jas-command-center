import { Database } from 'lucide-react'
import { cn } from '@/lib/cn'
import { STATUS_LABEL } from '@/lib/inventory/model'
import { STAGE_LABEL } from '@/lib/crm/model'
import type { DealStage, ItemStatus } from '@/lib/ops/types'

const TONE: Record<ItemStatus, string> = {
  in_storage: 'border-line text-ink',
  listed: 'border-sage-deep/40 bg-sage-soft text-forest',
  reserved: 'border-warn/40 bg-warn/10 text-warn',
  sold: 'border-brand/50 bg-brand/10 text-brand-ink',
  delivered: 'border-ok/40 bg-ok/10 text-ok',
  donated: 'border-line bg-sunken text-muted',
  recycled: 'border-line bg-sunken text-muted',
  disposed: 'border-line bg-sunken text-muted',
}

export function ItemStatusChip({ status }: { status: ItemStatus }) {
  return <span className={cn('inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs', TONE[status])}>{STATUS_LABEL[status]}</span>
}

export function StageChip({ stage }: { stage: DealStage }) {
  return <span className={cn('inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs', stage === 'won' ? 'border-ok/40 bg-ok/10 text-ok' : stage === 'lost' ? 'border-line bg-sunken text-muted' : 'border-line text-ink')}>{STAGE_LABEL[stage]}</span>
}

/** Migration 0003 not run, or the database failed: said plainly, never rendered as empty lists. */
export function OpsUnavailable({ message }: { message: string }) {
  return (
    <div role="alert" className="flex gap-3 rounded-md border border-dashed border-line bg-sunken/60 p-4 text-sm">
      <Database aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
      <div>
        <p className="font-medium text-ink">Customers and inventory are not available</p>
        <p className="mt-0.5 text-muted">{message}</p>
      </div>
    </div>
  )
}

export const linkCls = 'underline-offset-2 hover:underline'
export const btn = 'inline-flex h-10 items-center rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken'
