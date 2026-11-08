import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ChevronLeft } from 'lucide-react'
import { getOpsStore } from '@/lib/ops'
import { handoverQueue } from '@/lib/sales/views'
import { israelDate } from '@/lib/time'
import { buildToday } from '@/lib/portal/today'
import { cn } from '@/lib/cn'

const settle = async <T,>(p: Promise<T>): Promise<T | undefined> => {
  try {
    return await p
  } catch (e) {
    console.error('portal today read failed', e instanceof Error ? e.message : e)
    return undefined
  }
}

/**
 * "מה מחכה לי היום" for the shop floor: late and today's handovers, holds
 * that end today, and tasks. Each line opens the screen that does the job.
 * A queue that could not be read says so; it never reads as "nothing to do".
 */
export async function Today({ userId, inventory }: { userId: string; inventory: boolean }) {
  const ops = getOpsStore()
  const [handovers, reserved, tasks] = await Promise.all([
    inventory ? settle(handoverQueue({ crm: false, pii: false }).then((q) => q.list)) : Promise.resolve(null),
    inventory ? settle(ops.listItems({ statuses: ['reserved'], limit: 300 })) : Promise.resolve(null),
    settle(ops.listTasks({ status: 'open', limit: 500 })),
  ])
  const { lines, unreadable } = buildToday({ handovers, reserved, tasks, userId, today: israelDate() })

  return (
    <section aria-labelledby="today-h">
      <h2 id="today-h" className="mb-2 text-sm font-bold text-ink">מה מחכה לי היום</h2>
      {lines.length ? (
        <ul className="flex flex-col gap-2">
          {lines.map((l) => (
            <li key={l.key}>
              <Link
                href={l.href}
                className={cn('flex min-h-14 items-center gap-3 rounded-lg border bg-surface px-4 py-2 text-base shadow-card hover:bg-sunken', l.urgent ? 'border-forest/40 font-bold text-ink' : 'border-line text-ink')}
              >
                {l.urgent ? <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-forest" /> : <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-sage" />}
                <span className="flex-1">{l.text}</span>
                <ChevronLeft aria-hidden className="size-5 shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      ) : unreadable.length ? null : (
        <p className="flex min-h-14 items-center gap-3 rounded-lg border border-line bg-surface px-4 text-base text-muted">
          <CheckCircle2 aria-hidden className="size-5 shrink-0 text-ok" />
          אין כרגע משהו שמחכה לך. יום טוב
        </p>
      )}
      {unreadable.length ? (
        <p role="status" className="mt-2 flex items-center gap-2 text-sm text-warn">
          <AlertTriangle aria-hidden className="size-4 shrink-0" />
          לא הצלחנו לבדוק עכשיו: {unreadable.join(', ')}. כדאי להציץ במסכים עצמם.
        </p>
      ) : null}
    </section>
  )
}

export function TodaySkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      <div className="h-4 w-32 rounded bg-sunken" />
      <div className="h-14 rounded-lg bg-sunken" />
      <div className="h-14 rounded-lg bg-sunken" />
    </div>
  )
}
