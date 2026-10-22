import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { AlertsList } from '@/components/alerts-list'
import { visibleAlerts } from '@/lib/live'
import { requireUser } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  await requireUser()
  const alerts = await visibleAlerts()
  const by = (s: string) => alerts.filter((a) => a.severity === s)
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Derived live from the connected systems each time you open this page. Read/unread state, assignment, history and email delivery need the command center database and arrive in the next iteration."
      />
      <div className="flex flex-col gap-4">
        {(['critical', 'warning', 'info'] as const).map((s) => (
          <Card key={s}>
            <CardHeader title={s === 'critical' ? 'Critical' : s === 'warning' ? 'Warnings' : 'For information'} meta={`${by(s).length}`} />
            <CardBody>
              {by(s).length ? <AlertsList alerts={by(s)} /> : <p className="text-sm text-muted">None.</p>}
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  )
}
