import Link from 'next/link'
import { CircleAlert, CircleX, Info } from 'lucide-react'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { AlertsList } from '@/components/alerts-list'
import { notificationState } from '@/lib/live'
import { getSession, requireUser } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { notificationStore } from '@/lib/notifications/store'
import { formatDateTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { markReadAction } from './actions'

export const dynamic = 'force-dynamic'

const SEV = {
  critical: { Icon: CircleX, cls: 'text-bad', label: 'Critical' },
  warning: { Icon: CircleAlert, cls: 'text-warn', label: 'Warning' },
  info: { Icon: Info, cls: 'text-muted', label: 'Info' },
} as const
const HREF = { website: '/website', gift_cards: '/gift-cards', furniture: '/furniture', design_agent: '/design-agent', map: '/map' } as const

export default async function NotificationsPage() {
  await requireUser()
  const s = (await getSession())!
  const state = await notificationState()
  const unread = state.open.filter((n) => n.unread)
  const resolved = state.error
    ? []
    : (await notificationStore().history(100).catch(() => [])).filter((n) => n.resolvedAt && can(s.user.role, `${n.product}:read`, s.overrides)).slice(0, 30)

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Alerts are derived live from the connected systems; this page remembers when each one started and ended, and what you have already seen. An alert is only closed when its source was read successfully and the problem is gone."
        actions={
          unread.length ? (
            <form action={markReadAction}>
              {unread.map((n) => (
                <input key={n.id} type="hidden" name="id" value={n.id} />
              ))}
              <button className="h-9 rounded-full border border-line px-4 text-sm hover:bg-sunken">Mark all as read</button>
            </form>
          ) : null
        }
      />
      {state.error ? (
        <Card>
          <CardHeader title="Open now" meta={`${state.live.length}`} />
          <CardBody>
            <p role="alert" className="mb-3 rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">
              History is not being saved: {state.error}. Showing the live list only.
            </p>
            <AlertsList alerts={state.live} />
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Open now" meta={`${state.open.length} · ${unread.length} unread`} />
            <CardBody>
              {state.open.length ? (
                <ul className="divide-y divide-line/70">
                  {state.open.map((n) => {
                    const v = SEV[n.severity]
                    return (
                      <li key={n.id}>
                        <Link href={HREF[n.product]} className="-mx-2 flex gap-3 rounded-md px-2 py-2.5 hover:bg-sunken/60">
                          <v.Icon aria-label={v.label} className={cn('mt-0.5 h-4 w-4 shrink-0', v.cls)} strokeWidth={2} />
                          <div className="min-w-0 flex-1">
                            <div className={cn('text-sm text-ink', n.unread && 'font-semibold')}>
                              {n.title}
                              {n.unread ? <span className="ms-2 rounded-full bg-brand/20 px-1.5 text-meta font-medium text-forest">new</span> : null}
                            </div>
                            {n.detail ? <div className="truncate text-xs text-muted">{n.detail}</div> : null}
                          </div>
                          <time dateTime={n.firstSeenAt} title={`Since ${formatDateTime(n.firstSeenAt)}`} className="shrink-0 text-meta text-muted">
                            since {timeAgo(n.firstSeenAt)}
                          </time>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <AlertsList alerts={[]} />
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recently resolved" meta={`${resolved.length}`} />
            <CardBody>
              {resolved.length ? (
                <ul className="divide-y divide-line/70">
                  {resolved.map((n) => (
                    <li key={n.id} className="flex items-baseline justify-between gap-3 py-2">
                      <span className="min-w-0 truncate text-sm text-ink">{n.title}</span>
                      <span className="shrink-0 text-meta text-muted">
                        {formatDateTime(n.firstSeenAt)} → {formatDateTime(n.resolvedAt!)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Nothing resolved yet.</p>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </>
  )
}
