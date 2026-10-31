import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { listWebsiteContent, PARTNERS_KEY, SHOP_HOURS_KEYS, type WebsiteContentItem } from '@/lib/integrations/website/manage'
import { ContentField, PartnersForm, ShopHoursForm, type KeyState } from '../content-forms'
import { ListField } from '../list-field'

export const dynamic = 'force-dynamic'

/** The website manager's own section names (src/pages/manager/config.ts there), plus the shop-hours keys it edits in their own tab. */
const SECTION_LABELS: Record<string, string> = {
  navigation: 'Menu & footer',
  donate: 'Donate furniture',
  gift_card: 'Gift card page',
  shop: 'Shop hours',
  popup: 'Popup',
  announcement: 'Announcement bar',
  home: 'Home page',
  about: 'About',
  contact: 'Visit us / contact',
  services: 'Our projects',
  urban_renewal: 'Urban renewal',
  street_renewal: 'Street treasures',
  malls_industry: 'Malls & industry',
  workshops: 'Events at JAS',
  visit: 'Come visit',
  community: 'Area tours',
  join_community: 'Join the community',
  volunteer: 'Volunteering & donations',
}
const label = (s: string) => SECTION_LABELS[s] ?? s.replace(/_/g, ' ')

const SPECIAL = new Set<string>([...SHOP_HOURS_KEYS, PARTNERS_KEY])

export default async function WebsiteContentPage({ searchParams }: { searchParams?: { section?: string } }) {
  await requirePageAccess('website:read')
  const s = (await getSession())!
  const write = can(s.user.role, 'website:write', s.overrides)
  const r = await listWebsiteContent()
  const sections = r.state === 'ok' ? r.data.sections : []
  const wanted = typeof searchParams?.section === 'string' ? searchParams.section : ''
  const section = sections.includes(wanted) ? wanted : sections.includes('shop') ? 'shop' : (sections[0] ?? '')
  const items = r.state === 'ok' ? r.data.items.filter((i) => i.section === section && !SPECIAL.has(i.key)).sort((a, b) => a.sort_order - b.sort_order) : []
  const byKey = new Map(r.state === 'ok' ? r.data.items.map((i) => [i.key, i]) : [])
  const state = (i: WebsiteContentItem | undefined): KeyState => ({ value: i?.value ?? '', updatedAt: i?.updated_at ?? null })
  const partners = byKey.get(PARTNERS_KEY)

  return (
    <>
      <PageHeader
        title="Website content"
        description="Every text, image and video the website manager's content tab edits, plus shop hours and partner logos. Saved through the website's own endpoint, which applies the manager's rules and refuses an edit if someone changed the same text since you loaded it."
      />
      {r.state !== 'ok' ? (
        <SourceProblem result={r} what="Website content" />
      ) : (
        <div className="flex flex-col gap-4">
          <nav aria-label="Content sections" className="flex flex-wrap gap-2">
            {sections.map((x) => (
              <Link
                key={x}
                href={`/website/content?section=${x}`}
                aria-current={x === section ? 'page' : undefined}
                className={x === section ? 'rounded-full bg-forest px-3 py-2 text-sm font-medium text-cream' : 'rounded-full border border-line px-3 py-2 text-sm hover:bg-sunken'}
              >
                {label(x)}
              </Link>
            ))}
          </nav>
          <p className="text-xs text-muted">
            <Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} />
            {write ? '' : ' · Your role can view site content but not edit it.'}
          </p>

          {section === 'shop' ? (
            <Card>
              <CardHeader title="Online payment hours" />
              <CardBody>
                <p className="mb-3 text-sm text-muted">The shop is always visible; payment on the site is available only in these hours.</p>
                {write ? (
                  <ShopHoursForm
                    keys={{
                      shop_status_override: state(byKey.get('shop_status_override')),
                      shop_open_from: state(byKey.get('shop_open_from')),
                      shop_open_to: state(byKey.get('shop_open_to')),
                      shop_open_days: state(byKey.get('shop_open_days')),
                    }}
                  />
                ) : (
                  <p className="text-sm" dir="ltr">
                    {byKey.get('shop_status_override')?.value} · {byKey.get('shop_open_from')?.value}–{byKey.get('shop_open_to')?.value} · days {byKey.get('shop_open_days')?.value || 'none'}
                  </p>
                )}
              </CardBody>
            </Card>
          ) : null}

          {partners && partners.section === section ? (
            <Card>
              <CardHeader title="Partner logos" />
              <CardBody>{write ? <PartnersForm raw={partners.value} updatedAt={partners.updated_at} /> : <p className="text-sm text-muted">Your role can view partners but not edit them.</p>}</CardBody>
            </Card>
          ) : null}

          {items.length ? (
            <Card>
              <CardHeader title={label(section)} />
              <CardBody>
                <ul className="flex flex-col gap-4">
                  {items.map((i) => (
                    <li key={i.key}>
                      {i.list ? (
                        write ? (
                          <ListField item={{ key: i.key, label: i.label, value: i.value, updatedAt: i.updated_at, list: i.list }} />
                        ) : (
                          <ListView label={i.label} value={i.value} />
                        )
                      ) : write ? (
                        <ContentField item={{ key: i.key, label: i.label, type: i.type, value: i.value, updatedAt: i.updated_at }} />
                      ) : (
                        <div className="text-sm">
                          <p className="text-muted" dir="auto">{i.label}</p>
                          <p dir="auto" className="whitespace-pre-wrap break-words">{i.value || '—'}</p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      )}
    </>
  )
}

function ListView({ label, value }: { label: string; value: string }) {
  let rows: Record<string, string>[] = []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) rows = parsed
  } catch {
    /* shown as empty */
  }
  return (
    <div className="text-sm">
      <p className="text-muted" dir="auto">{label}</p>
      <ol className="list-decimal ps-5" dir="auto">
        {rows.map((r, n) => (
          <li key={n}>{Object.values(r).filter(Boolean).slice(0, 2).join(' · ')}</li>
        ))}
      </ol>
    </div>
  )
}
