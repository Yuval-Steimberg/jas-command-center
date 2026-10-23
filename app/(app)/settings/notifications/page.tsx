import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { requireUser } from '@/lib/auth/session'
import { PRODUCTS } from '@/lib/auth/rbac'
import { env } from '@/lib/env'
import { notificationStore } from '@/lib/notifications/store'
import { PrefsForm } from '../../notifications/forms'

export const dynamic = 'force-dynamic'

const PRODUCT_LABELS = { website: 'Website & shop', gift_cards: 'Gift cards', furniture: 'Furniture', design_agent: 'Design agent', map: 'Map' } as const

export default async function NotificationSettingsPage() {
  const user = await requireUser()
  let loaded: Awaited<ReturnType<ReturnType<typeof notificationStore>['getPrefs']>> | null = null
  let error: string | null = null
  try {
    loaded = await notificationStore().getPrefs(user.id)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const e = env().email
  return (
    <>
      <PageHeader title="My notifications" description="What shows in your notification list, and what is emailed to you. These settings are yours only." />
      <p className="mb-4 text-sm"><Link href="/notifications" className="underline-offset-2 hover:underline">← Notifications</Link></p>
      <Card>
        <CardHeader title="Settings" meta={user.email} />
        <CardBody>
          {error ? <p role="alert" className="text-sm text-bad">Could not read your settings: {error}</p> : !loaded!.available ? (
            <p className="text-sm text-muted">Settings need one database step: run <code className="rounded bg-sunken px-1">supabase/migrations/0002_notification_prefs.sql</code> in the command center&apos;s Supabase SQL Editor. Until then everything shows and nothing is emailed.</p>
          ) : (
            <PrefsForm
              prefs={loaded!.prefs}
              products={PRODUCTS.map((p) => ({ id: p, label: PRODUCT_LABELS[p] }))}
              severities={[{ id: 'info', label: 'Info and above (everything)' }, { id: 'warning', label: 'Warnings and critical' }, { id: 'critical', label: 'Critical only' }]}
              emailAlerts={[{ id: 'off', label: 'Never' }, { id: 'warning', label: 'Warnings and critical' }, { id: 'critical', label: 'Critical only' }]}
              emailReports={[{ id: 'off', label: 'Never' }, { id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly (Sunday)' }, { id: 'monthly', label: 'Monthly (the 1st)' }]}
              emailReady={Boolean(e.sendgridKey && e.from)}
            />
          )}
        </CardBody>
      </Card>
    </>
  )
}
