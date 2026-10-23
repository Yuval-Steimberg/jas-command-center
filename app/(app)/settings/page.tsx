import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { getSession, requireUser, userCan } from '@/lib/auth/session'
import { can, PRODUCTS, ACTIONS, ROLES, ROLE_LABELS, type Permission } from '@/lib/auth/rbac'
import { listAudit } from '@/lib/audit/audit'
import { formatDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const user = await requireUser()
  const overrides = (await getSession())?.overrides
  const showAudit = await userCan('audit:read')
  let audit: Awaited<ReturnType<typeof listAudit>> | null = null
  let auditError: string | null = null
  if (showAudit) {
    try {
      audit = await listAudit(100)
    } catch (e) {
      auditError = e instanceof Error ? e.message : String(e)
    }
  }
  return (
    <>
      <PageHeader title="Settings" description={`Signed in as ${user.email} · ${ROLE_LABELS[user.role]}`} />
      <p className="mb-4 flex flex-wrap gap-x-4 text-sm">
        {(await userCan('users:manage')) ? <Link href="/settings/staff" className="font-medium underline-offset-2 hover:underline">Staff: invite, change role, deactivate</Link> : null}
        <Link href="/settings/notifications" className="underline-offset-2 hover:underline">My notification settings</Link>
      </p>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Roles and permissions" meta="Defaults; per-deployment overrides live in cc_role_permissions." />
          <CardBody className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 text-start font-medium">Permission</th>
                  {ROLES.map((r) => <th key={r} className="px-2 text-center font-medium">{ROLE_LABELS[r]}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...PRODUCTS.flatMap((p) => ACTIONS.map((a) => `${p}:${a}` as Permission)), 'integrations:read', 'audit:read', 'users:manage', 'assistant:use'].map((perm) => (
                  <tr key={perm} className="border-t border-line/50">
                    <td className="py-1 font-mono">{perm}</td>
                    {ROLES.map((r) => <td key={r} className="px-2 text-center">{can(r, perm as Permission, overrides) ? <span aria-label="allowed" className="text-ok">●</span> : <span aria-label="not allowed" className="text-line">○</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
        {showAudit ? (
          <Card>
            <CardHeader title="Audit log" meta="Every sign-in and every action, with who, what and the outcome the source confirmed" />
            <CardBody className="overflow-x-auto">
              {auditError ? (
                <p className="text-sm text-bad">Could not read the audit log: {auditError}</p>
              ) : !audit?.length ? (
                <p className="text-sm text-muted">No entries yet.</p>
              ) : (
                <table className="w-full min-w-[720px] text-xs">
                  <thead className="text-muted"><tr><th className="py-1 text-start font-medium">When</th><th className="text-start font-medium">Who</th><th className="text-start font-medium">Action</th><th className="text-start font-medium">Target</th><th className="text-start font-medium">Outcome</th></tr></thead>
                  <tbody>
                    {audit.map((a) => (
                      <tr key={a.id} className="border-t border-line/50">
                        <td className="py-1.5 pe-2">{formatDateTime(a.at)}</td>
                        <td className="pe-2">{a.actorEmail}{a.via !== 'user' ? ` (${a.via})` : ''}</td>
                        <td className="pe-2 font-mono">{a.action}</td>
                        <td className="pe-2 font-mono">{a.target ?? '—'}</td>
                        <td className={a.outcome === 'failed' || a.outcome === 'denied' ? 'text-bad' : a.outcome === 'succeeded' ? 'text-ok' : 'text-muted'}>{a.outcome}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  )
}
