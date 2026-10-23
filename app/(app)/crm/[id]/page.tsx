import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { SourceProblem } from '@/components/ui/source-state'
import { ItemStatusChip, OpsUnavailable, StageChip, btn, linkCls } from '@/components/ops/ui'
import { ContactFields } from '@/components/ops/contact-fields'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { contactLabel } from '@/lib/ops/views'
import type { Channel } from '@/lib/ops/types'
import { CHANNEL_LABEL, ROLE_LABEL, daysWithoutContact, OPEN_STAGES, whatsappLink } from '@/lib/crm/model'
import { listWebsiteOrders } from '@/lib/integrations/website/manage'
import { searchGiftCards } from '@/lib/integrations/gift-cards/adapter'
import { formatAgorot, shekelsToAgorot } from '@/lib/money'
import { formatDateTime, timeAgo } from '@/lib/format'
import { input } from '../../website/forms'
import { ActionForm, Field } from '../../inventory/forms'
import { createDealAction, logInteractionAction, saveContactAction } from '../actions'

export const dynamic = 'force-dynamic'

const LOGGABLE: Channel[] = ['whatsapp', 'phone', 'email', 'in_person', 'note']

export default async function ContactPage({ params }: { params: { id: string } }) {
  await requirePageAccess('crm:read')
  if (!z.string().uuid().safeParse(params.id).success) notFound()
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const pii = may('crm:read_pii')

  const res = await loadOps(async () => {
    const store = getOpsStore()
    const c = await store.getContact(params.id)
    if (!c) return null
    const [deals, interactions, tasks, bought, reserved] = await Promise.all([
      store.listDeals({ contactId: c.id }),
      store.listInteractions({ contactId: c.id, limit: 100 }),
      store.listTasks({ entityKind: 'contact', entityId: c.id }),
      may('inventory:read') ? store.listItems({ buyerContactId: c.id, limit: 100 }) : Promise.resolve([]),
      may('inventory:read') ? store.listItems({ reservedFor: c.id, limit: 100 }) : Promise.resolve([]),
    ])
    return { c, deals, interactions, tasks, bought, reserved }
  })
  if (res.ok && !res.data) notFound()
  if (!res.ok) {
    return (
      <>
        <PageHeader title="Contact" />
        <OpsUnavailable message={res.message} />
      </>
    )
  }
  const { c, deals, interactions, tasks, bought, reserved } = res.data!
  const email = c.email
  // Live reads from the systems that own the records. Matched on the exact address: the source search is a substring match.
  const [orders, cards] = await Promise.all([
    pii && email && may('website:read_pii') ? listWebsiteOrders(email) : null,
    pii && email && may('gift_cards:read_pii') ? searchGiftCards(email) : null,
  ])
  const same = (x: string | null | undefined) => !!x && x.trim().toLowerCase() === email
  const wa = pii ? whatsappLink(c.phone) : null

  return (
    <>
      <PageHeader
        title={pii ? c.fullName : contactLabel(c, false)}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{c.roles.map((r) => ROLE_LABEL[r]).join(' · ') || 'No role'}</span>
            {pii && c.phone ? <a href={`tel:${c.phone}`} dir="ltr" className={linkCls}>{c.phone}</a> : null}
            {pii && c.email ? <a href={`mailto:${c.email}`} dir="ltr" className={linkCls}>{c.email}</a> : null}
            <span className="text-faint">came from {c.source.replace('_', ' ')} · added {timeAgo(c.createdAt)}</span>
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {wa ? <a href={wa} target="_blank" rel="noreferrer" className={btn}>Open WhatsApp chat</a> : null}
            <Link href={`/tasks?entity=contact&id=${c.id}`} className={btn}>Add a task</Link>
          </div>
        }
      />
      {!pii ? <p className="mb-4 text-sm text-muted">Names, phones, emails and the contents of conversations are hidden for your role.</p> : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Timeline" meta={`${interactions.length} entries`} />
            <CardBody>
              {may('crm:operate') ? (
                <ActionForm action={logInteractionAction} hidden={{ contactId: c.id }} label="Log it" busy="Saving…" className="mb-4 flex flex-col gap-2 rounded-md border border-line/70 bg-ground/40 p-3">
                  <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr]">
                    <label><span className="sr-only">Channel</span>
                      <select name="channel" defaultValue="whatsapp" className={input}>
                        {LOGGABLE.map((ch) => <option key={ch} value={ch}>{CHANNEL_LABEL[ch]}</option>)}
                      </select>
                    </label>
                    <label><span className="sr-only">Direction</span>
                      <select name="direction" defaultValue="out" className={input}>
                        <option value="out">We reached out</option>
                        <option value="in">They reached us</option>
                        <option value="none">Note only</option>
                      </select>
                    </label>
                    <label className="min-w-0"><span className="sr-only">What happened</span><input name="summary" required dir="auto" maxLength={1000} placeholder="One line: what was said or agreed" className={input} /></label>
                  </div>
                </ActionForm>
              ) : null}
              {interactions.length === 0 ? <p className="text-sm text-muted">Nothing recorded yet.</p> : (
                <ol className="flex flex-col gap-3">
                  {interactions.map((x) => (
                    <li key={x.id} className="border-s-2 border-line ps-3 text-sm">
                      <div className="text-xs text-muted">
                        {CHANNEL_LABEL[x.channel]}{x.direction === 'in' ? ' · from them' : x.direction === 'out' ? ' · from us' : ''} · {formatDateTime(x.at)} · {x.actorEmail}
                      </div>
                      {pii ? <p dir="auto" className="mt-0.5 whitespace-pre-line">{x.summary}</p> : null}
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Leads" meta={`${deals.filter((d) => OPEN_STAGES.includes(d.stage)).length} open`} action={<Link href="/crm/pipeline" className={`${linkCls} text-sm`}>Pipeline</Link>} />
            <CardBody>
              {deals.length === 0 ? <p className="text-sm text-muted">No leads.</p> : (
                <ul className="flex flex-col divide-y divide-line/60 text-sm">
                  {deals.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                      <StageChip stage={d.stage} />
                      <span dir="auto" className="min-w-0 flex-1">{pii ? d.title : `Lead from ${d.source.replace('_', ' ')}`}</span>
                      {d.valueMinor ? <span className="num text-muted">{formatAgorot(d.valueMinor, { whole: true })}</span> : null}
                      {OPEN_STAGES.includes(d.stage) ? <span className="text-xs text-muted">{daysWithoutContact(d)} days since contact</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              {may('crm:write') ? (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-muted">Add a lead</summary>
                  <ActionForm action={createDealAction} hidden={{ contactId: c.id }} label="Add lead" busy="Saving…" className="mt-2 flex flex-col gap-2">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Field label="About"><input name="title" required dir="auto" maxLength={200} placeholder="e.g. wants a dining table" className={input} /></Field>
                      <Field label="Value (₪, optional)"><input name="value" inputMode="decimal" dir="ltr" className={input} /></Field>
                      <Field label="Next step"><input name="nextStep" dir="auto" maxLength={200} className={input} /></Field>
                    </div>
                  </ActionForm>
                </details>
              ) : null}
            </CardBody>
          </Card>

          {may('crm:write') ? (
            <Card>
              <CardHeader title="Edit contact" />
              <CardBody>
                <ActionForm action={saveContactAction} hidden={{ id: c.id }} label="Save" busy="Saving…">
                  {pii ? <ContactFields c={c} /> : <p className="text-sm text-muted">Editing needs permission to see personal details.</p>}
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Open tasks" />
            <CardBody>
              {tasks.filter((t) => t.status === 'open').length === 0 ? <p className="text-sm text-muted">None.</p> : (
                <ul className="flex flex-col gap-2 text-sm">
                  {tasks.filter((t) => t.status === 'open').map((t) => (
                    <li key={t.id}><Link href={`/tasks#t-${t.id}`} className={linkCls} dir="auto">{t.title}</Link>{t.dueAt ? <span className="text-xs text-muted"> · due {formatDateTime(t.dueAt)}</span> : null}</li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {may('inventory:read') ? (
            <Card>
              <CardHeader title="Items" meta="bought or reserved here" />
              <CardBody>
                {bought.length + reserved.length === 0 ? <p className="text-sm text-muted">None.</p> : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {[...reserved, ...bought].map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center gap-2">
                        <ItemStatusChip status={i.status} />
                        <Link href={`/inventory/${i.id}`} className={linkCls} dir="auto">{i.sku} · {i.title}</Link>
                        {i.soldPriceMinor ? <span className="num text-muted">{formatAgorot(i.soldPriceMinor)}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ) : null}

          {orders ? (
            <Card>
              <CardHeader title="Website orders" meta="read live from the website" />
              <CardBody>
                {orders.state !== 'ok' ? <SourceProblem result={orders} what="website orders" /> : (() => {
                  const mine = orders.data.filter((o) => same(o.customer_email))
                  return mine.length === 0 ? <p className="text-sm text-muted">No orders with this email.</p> : (
                    <ul className="flex flex-col gap-2 text-sm">
                      {mine.map((o) => (
                        <li key={o.id} className="flex flex-wrap gap-x-2">
                          <Link href={`/website/orders?q=${encodeURIComponent(o.order_number)}`} className={linkCls} dir="ltr">{o.order_number}</Link>
                          <span className="num">{formatAgorot(shekelsToAgorot(o.total))}</span>
                          <span className="text-muted">{o.status} · {formatDateTime(o.created_at)}</span>
                        </li>
                      ))}
                    </ul>
                  )
                })()}
                <p className="mt-2 text-meta text-faint">Includes gift cards bought in the website shop (they are website revenue, never added to the gift card system).</p>
              </CardBody>
            </Card>
          ) : null}

          {cards ? (
            <Card>
              <CardHeader title="Gift cards" meta="read live; codes masked" />
              <CardBody>
                {cards.state !== 'ok' ? <SourceProblem result={cards} what="gift cards" /> : (() => {
                  const mine = cards.data.items.filter((g) => same(g.buyerEmail) || same(g.recipientEmail))
                  return mine.length === 0 ? <p className="text-sm text-muted">No gift cards bought or received with this email.</p> : (
                    <ul className="flex flex-col gap-2 text-sm">
                      {mine.map((g) => (
                        <li key={g.id} className="flex flex-wrap gap-x-2">
                          <Link href={`/gift-cards/${g.id}`} className={linkCls} dir="ltr">{g.maskedCode}</Link>
                          <span>{same(g.buyerEmail) ? 'bought' : 'received'}</span>
                          <span className="num text-muted">{formatAgorot(g.balanceMinor)} of {formatAgorot(g.initialAmountMinor)} left · {g.status}</span>
                        </li>
                      ))}
                    </ul>
                  )
                })()}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  )
}

