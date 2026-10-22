import { cn } from '@/lib/cn'

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn('min-w-0 rounded-lg border border-line bg-surface shadow-card', className)}>{children}</section>
}

export function CardHeader({ title, meta, action }: { title: React.ReactNode; meta?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-line/70 px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {meta ? <div className="mt-0.5 text-meta text-muted">{meta}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  )
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('px-4 py-3', className)}>{children}</div>
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions}
    </div>
  )
}
