import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { listWebsiteInquiries, type InquiryFilter } from '@/lib/integrations/website/manage'
import { InquiryHandled } from '../inquiry-forms'

export const dynamic = 'force-dynamic'

const KIND: Record<string, string> = { contact: 'Contact form', volunteer: 'Volunteer', donate: 'Equipment donation' }
const FILTERS: [InquiryFilter, string][] = [['open', 'Open'], ['handled', 'Handled'], ['all', 'All']]
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const wa = (phone: string) => `https://wa.me/972${phone.replace(/\D/g, '').replace(/^0/, '')}`

export default async function WebsiteInquiriesPage({ searchParams }: { searchParams?: { status?: string } }) {
  await requirePageAccess('website:read')
  const s = (await getSession())!
  const pii = can(s.user.role, 'website:read_pii', s.overrides)
  const operate = can(s.user.role, 'website:operate', s.overrides)
  const status: InquiryFilter = searchParams?.status === 'handled' || searchParams?.status === 'all' ? searchParams.status : 'open'
  const r = pii ? await listWebsiteInquiries(status) : null
  return (
    <>
      <PageHeader title="Website messages" description="Everything sent through the site's contact, volunteer and equipment-donation forms. Each message is also emailed to the business address." />
      <p className="mb-4 text-sm"><Link href="/website" className="underline-offset-2 hover:underline">← Website & shop</Link></p>
      {!r ? (
        <p className="text-sm text-muted">These messages carry names and phone numbers; your role cannot see customer details.</p>
      ) : (
        <>
          <nav aria-label="Message filter" className="mb-4 flex flex-wrap gap-2">
            {FILTERS.map(([v, label]) => (
              <Link key={v} href={`/website/inquiries?status=${v}`} aria-current={v === status ? 'page' : undefined} className={v === status ? 'rounded-full bg-forest px-3 py-2 text-sm font-medium text-cream' : 'rounded-full border border-line px-3 py-2 text-sm hover:bg-sunken'}>
                {label}{v === 'open' && r.state === 'ok' && r.data.openCount ? ` (${r.data.openCount})` : ''}
              </Link>
            ))}
          </nav>
          <Card>
            <CardHeader title="Messages" meta={r.state === 'ok' ? <Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} /> : undefined} />
            <CardBody>
              {r.state !== 'ok' ? (
                <SourceProblem result={r} what="Website messages" />
              ) : !r.data.inquiries.length ? (
                <p className="text-sm text-muted">{status === 'open' ? 'No open messages.' : 'No messages.'}</p>
              ) : (
                <ul className="divide-y divide-line/70">
                  {r.data.inquiries.map((m) => (
                    <li key={m.id} className="flex flex-col gap-2 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <span className="rounded-full border border-line px-2 py-0.5 text-xs">{KIND[m.kind]}</span>
                        <span dir="auto" className="font-medium">{m.name}</span>
                        {m.phone ? <a href={wa(m.phone)} target="_blank" rel="noreferrer noopener" dir="ltr" className="underline-offset-2 hover:underline">{m.phone}</a> : null}
                        {m.email ? <a href={`mailto:${m.email}`} dir="ltr" className="break-all underline-offset-2 hover:underline">{m.email}</a> : null}
                        <span className="text-xs text-muted">{when(m.created_at)}{m.emailed ? '' : ' · email not delivered'}</span>
                      </div>
                      {m.subject ? <p dir="auto" className="text-sm font-medium">{m.subject}</p> : null}
                      <p dir="auto" className="whitespace-pre-wrap break-words text-sm">{m.message}</p>
                      {m.photos.length ? (
                        <div className="flex flex-wrap gap-2">
                          {m.photos.filter((p) => p.startsWith('data:image/')).map((p, i) => (
                            <a key={i} href={p} target="_blank" rel="noreferrer noopener">
                              {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL */}
                              <img src={p} alt={`Photo ${i + 1}`} className="h-20 w-20 rounded-md border border-line object-cover" />
                            </a>
                          ))}
                        </div>
                      ) : null}
                      {m.handled_at ? <p className="text-xs text-muted">Handled {when(m.handled_at)}{m.handled_by ? ` by ${m.handled_by}` : ''}</p> : null}
                      {operate ? <InquiryHandled id={m.id} kind={m.kind} handled={!!m.handled_at} /> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </>
  )
}
