import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { listWebsiteProducts } from '@/lib/integrations/website/manage'
import { formatAgorot, shekelsToAgorot } from '@/lib/money'
import { ProductForm } from '../forms'

export const dynamic = 'force-dynamic'

const ils = (v: number | null | undefined) => (v == null ? '—' : formatAgorot(shekelsToAgorot(v)))

export default async function WebsiteProductsPage({ searchParams }: { searchParams?: { q?: string } }) {
  await requirePageAccess('website:read')
  const s = (await getSession())!
  const write = can(s.user.role, 'website:write', s.overrides)
  const q = (typeof searchParams?.q === 'string' ? searchParams.q : '').trim().slice(0, 100)
  const r = await listWebsiteProducts(q)
  return (
    <>
      <PageHeader
        title="Website products"
        description="Price, strike-through price, stock quantity and featured flag, written through the website's own endpoint (stock follows quantity, as in the website's product form). Names, descriptions, images, categories and publishing stay in the website manager."
      />
      <p className="mb-4 text-sm"><Link href="/website" className="underline-offset-2 hover:underline">← Website & shop</Link> · <Link href="/website/orders" className="underline-offset-2 hover:underline">Orders</Link></p>
      <Card>
        <CardHeader title="Products" meta={r.state === 'ok' ? <Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} /> : undefined} />
        <CardBody>
          <form action="/website/products" className="mb-3 flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1"><span className="sr-only">Search</span><input name="q" defaultValue={q} dir="auto" maxLength={100} placeholder="Product name or slug" className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm" /></label>
            <button className="h-10 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken">Search</button>
          </form>
          {r.state !== 'ok' ? (
            <SourceProblem result={r} what="Website products" />
          ) : !r.data.length ? (
            <p className="text-sm text-muted">No products match.</p>
          ) : (
            <ul className="divide-y divide-line/70">
              {r.data.map((p) => (
                <li key={p.id} className="py-2">
                  <details>
                    <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span dir="auto" className="min-w-0 flex-1 truncate font-medium">{p.name_he}</span>
                      <span className="num">{ils(p.price)}{p.original_price ? <span className="ms-1 text-xs text-muted line-through">{ils(p.original_price)}</span> : null}</span>
                      <span className={p.in_stock ? 'text-xs' : 'text-xs text-bad'}>{p.in_stock ? `${p.quantity ?? '?'} in stock` : 'out of stock'}</span>
                      {p.featured ? <span className="rounded-full border border-line px-2 py-0.5 text-xs">featured</span> : null}
                      {p.published === false ? <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">draft</span> : null}
                    </summary>
                    <div className="mt-3 pb-2">
                      <p className="mb-2 text-xs text-muted">{p.categories?.name_he ?? p.categories?.name_en ?? 'No category'} · <span dir="ltr">{p.slug}</span></p>
                      {write ? (
                        <ProductForm p={{ id: p.id, slug: p.slug, name: p.name_he, price: p.price, originalPrice: p.original_price, quantity: p.quantity, featured: p.featured, updatedAt: p.updated_at }} />
                      ) : (
                        <p className="text-xs text-muted">Your role can view products but not edit them.</p>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
          {r.state === 'ok' && r.data.length === 200 ? <p className="mt-2 text-meta text-muted">Showing the 200 most recently updated. Search to find others.</p> : null}
        </CardBody>
      </Card>
    </>
  )
}
