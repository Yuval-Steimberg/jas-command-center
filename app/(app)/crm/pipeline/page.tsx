import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { OpsUnavailable, StageChip, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { contactLabel } from '@/lib/ops/views'
import { DEAL_STAGES } from '@/lib/ops/types'
import { OPEN_STAGES, STAGE_LABEL, daysWithoutContact } from '@/lib/crm/model'
import { STALE_LEAD_DAYS } from '@/lib/ops/summary'
import { formatAgorot } from '@/lib/money'
import { timeAgo } from '@/lib/format'
import { input } from '../../website/forms'
import { ActionForm } from '../../inventory/forms'
import { setDealStageAction } from '../actions'

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  await requirePageAccess('crm:read')
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const pii = may('crm:read_pii')
  const res = await loadOps(async () => {
    const store = getOpsStore()
    const deals = await store.listDeals({ limit: 500 })
    const ids = [...new Set(deals.map((d) => d.contactId))]
    const contacts = ids.length ? await store.listContacts({ ids, limit: 500 }) : []
    return { deals, contacts: new Map(contacts.map((c) => [c.id, c])) }
  })

  return (
    <>
      <PageHeader
        title="Leads pipeline"
        description={`Every open lead by stage. A new lead nobody has contacted for ${STALE_LEAD_DAYS} days is flagged here and on the attention list. Logging a call or message on the contact moves a new lead to "contacted" by itself.`}
        actions={<Link href="/crm" className={linkCls}>All contacts</Link>}
      />
      {!res.ok ? <OpsUnavailable message={res.message} /> : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {OPEN_STAGES.map((stage) => {
              const here = res.data.deals.filter((d) => d.stage === stage)
              return (
                <Card key={stage}>
                  <CardHeader title={STAGE_LABEL[stage]} meta={`${here.length}`} />
                  <CardBody>
                    {here.length === 0 ? <p className="text-sm text-muted">Empty.</p> : (
                      <ul className="flex flex-col gap-3">
                        {here.map((d) => {
                          const c = res.data.contacts.get(d.contactId)
                          const days = daysWithoutContact(d)
                          const stale = d.stage === 'new' && days >= STALE_LEAD_DAYS
                          return (
                            <li key={d.id} className={`rounded-md border p-3 text-sm ${stale ? 'border-warn/50 bg-warn/5' : 'border-line/70'}`}>
                              <Link href={`/crm/${d.contactId}`} className={`${linkCls} font-medium`} dir="auto">{c ? contactLabel(c, pii) : 'Unknown contact'}</Link>
                              {pii ? <p dir="auto" className="mt-0.5 text-muted">{d.title}</p> : null}
                              <p className="mt-1 text-xs text-muted">
                                {d.valueMinor ? `${formatAgorot(d.valueMinor, { whole: true })} · ` : ''}
                                {stale ? <span className="font-medium text-warn">{days} days, not contacted</span> : d.lastContactedAt ? `contacted ${timeAgo(d.lastContactedAt)}` : `added ${timeAgo(d.createdAt)}`}
                                {d.nextStep && pii ? ` · next: ${d.nextStep}` : ''}
                              </p>
                              {may('crm:operate') ? (
                                <ActionForm action={setDealStageAction} hidden={{ id: d.id, from: d.stage }} label="Move" busy="Moving…" className="mt-2 flex flex-wrap items-start gap-2">
                                  <label className="min-w-0 flex-1"><span className="sr-only">Stage</span>
                                    <select name="stage" defaultValue={d.stage} className={input}>
                                      {DEAL_STAGES.map((x) => <option key={x} value={x}>{STAGE_LABEL[x]}</option>)}
                                    </select>
                                  </label>
                                </ActionForm>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </CardBody>
                </Card>
              )
            })}
          </div>
          <Card className="mt-4">
            <CardHeader title="Closed recently" />
            <CardBody>
              {(() => {
                const closed = res.data.deals.filter((d) => !OPEN_STAGES.includes(d.stage)).sort((a, b) => (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt)).slice(0, 20)
                return closed.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {closed.map((d) => {
                      const c = res.data.contacts.get(d.contactId)
                      return (
                        <li key={d.id} className="flex flex-wrap items-center gap-2">
                          <StageChip stage={d.stage} />
                          <Link href={`/crm/${d.contactId}`} className={linkCls} dir="auto">{c ? contactLabel(c, pii) : 'Unknown contact'}</Link>
                          {pii ? <span dir="auto" className="text-muted">{d.title}</span> : null}
                          <span className="text-xs text-faint">{timeAgo(d.closedAt ?? d.updatedAt)}</span>
                        </li>
                      )
                    })}
                  </ul>
                )
              })()}
            </CardBody>
          </Card>
        </>
      )}
    </>
  )
}
