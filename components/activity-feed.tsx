import Link from 'next/link'
import { CircleCheck, CircleX, Dot } from 'lucide-react'
import type { ActivityFeed } from '@/lib/activity/feed'
import { formatDateTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'

const TONE = {
  good: { Icon: CircleCheck, cls: 'text-ok' },
  bad: { Icon: CircleX, cls: 'text-bad' },
  neutral: { Icon: Dot, cls: 'text-muted' },
} as const

export function ActivityList({ feed }: { feed: ActivityFeed }) {
  return (
    <div className="flex flex-col gap-3">
      {feed.items.length ? (
        <ol className="divide-y divide-line/70">
          {feed.items.map((i) => {
            const t = TONE[i.tone]
            const body = (
              <>
                <t.Icon aria-hidden className={cn('mt-0.5 h-4 w-4 shrink-0', t.cls)} strokeWidth={2} />
                <div className="min-w-0 flex-1">
                  <div dir="auto" className="text-sm text-ink">{i.title}</div>
                  {i.detail ? <div dir="auto" className="truncate text-xs text-muted">{i.detail}</div> : null}
                </div>
                <time dateTime={i.at} title={formatDateTime(i.at)} className="shrink-0 text-meta text-muted">
                  {timeAgo(i.at)}
                </time>
              </>
            )
            return (
              <li key={i.id}>
                {i.href ? (
                  <Link href={i.href} className="-mx-2 flex gap-3 rounded-md px-2 py-2 hover:bg-sunken/60">
                    {body}
                  </Link>
                ) : (
                  <div className="flex gap-3 py-2">{body}</div>
                )}
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted">No recorded activity yet in the sources below.</p>
      )}
      {feed.gaps.length ? (
        <details className="text-meta text-muted">
          <summary className="cursor-pointer">Not in this feed ({feed.gaps.length})</summary>
          <ul className="mt-1 list-disc ps-5">
            {feed.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
