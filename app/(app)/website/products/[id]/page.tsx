import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getWebsiteProduct, getWebsiteProductMeta } from '@/lib/integrations/website/manage'
import { formatAgorot, shekelsToAgorot } from '@/lib/money'
import { AddCategoryForm, DeleteProduct, FullProductForm } from '../../product-forms'

export const dynamic = 'force-dynamic'

const str = (v: string | number | null | undefined) => (v == null ? '' : String(v))

export default async function ProductPage({ params, searchParams }: { params: { id: string }; searchParams?: { created?: string } }) {
  await requirePageAccess('website:read')
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) notFound()
  const s = (await getSession())!
  const write = can(s.user.role, 'website:write', s.overrides)
  const [r, meta] = await Promise.all([getWebsiteProduct(id), getWebsiteProductMeta()])
  if (r.state === 'ok' && !r.data) notFound()
  const p = r.state === 'ok' ? r.data! : null
  const categories = meta.state === 'ok' ? meta.data.categories : []
  return (
    <>
      <PageHeader title={p ? p.name_he : 'Product'} description={p ? `/product/${p.slug} · ${p.published === false ? 'draft' : 'in the shop'}` : undefined} />
      <p className="mb-4 text-sm"><Link href="/website/products" className="underline-offset-2 hover:underline">← Products</Link></p>
      {searchParams?.created ? <p role="status" className="mb-3 text-sm text-ok">Product created.</p> : null}
      {r.state !== 'ok' ? (
        <SourceProblem result={r} what="Website product" />
      ) : p ? (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Product" meta={<Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} />} />
            <CardBody>
              {write && meta.state !== 'ok' ? <div className="mb-3"><SourceProblem result={meta} what="Website product categories" /></div> : null}
              {write && meta.state === 'ok' ? (
                <FullProductForm
                  categories={categories}
                  p={{
                    id: p.id, updatedAt: p.updated_at, name_he: p.name_he, name_en: str(p.name_en), slug: p.slug, description_he: str(p.description_he),
                    description_en: str(p.description_en), story_he: str(p.story_he), story_en: str(p.story_en), price: str(p.price), original_price: str(p.original_price),
                    category_id: str(p.category_id), condition: str(p.condition), style: str(p.style), dimensions: str(p.dimensions), material: str(p.material),
                    origin: str(p.origin), image_url: str(p.image_url), images: p.images ?? [], featured: !!p.featured, quantity: str(p.quantity ?? 0), tags: p.tags ?? [],
                    published: p.published === undefined ? null : p.published !== false,
                  }}
                />
              ) : !write ? (
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted">Price</dt><dd className="num">{p.price == null ? '—' : formatAgorot(shekelsToAgorot(p.price))}</dd></div>
                  <div><dt className="text-muted">Quantity</dt><dd className="num">{p.quantity ?? '—'}</dd></div>
                  <div><dt className="text-muted">Category</dt><dd>{categories.find((c) => c.id === p.category_id)?.name_he ?? '—'}</dd></div>
                  <div><dt className="text-muted">Condition</dt><dd>{p.condition ?? '—'}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-muted">Description</dt><dd dir="rtl" className="whitespace-pre-wrap break-words">{p.description_he || '—'}</dd></div>
                </dl>
              ) : null}
            </CardBody>
          </Card>
          {write ? (
            <>
              <Card>
                <CardHeader title="Categories" />
                <CardBody><AddCategoryForm /></CardBody>
              </Card>
              <Card>
                <CardHeader title="Delete" />
                <CardBody><DeleteProduct id={p.id} updatedAt={p.updated_at} slug={p.slug} name={p.name_he} /></CardBody>
              </Card>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
