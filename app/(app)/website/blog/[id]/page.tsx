import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getWebsitePost } from '@/lib/integrations/website/manage'
import { BlogPostForm, DeleteBlogPost } from '../../blog-forms'

export const dynamic = 'force-dynamic'

export default async function BlogPostPage({ params, searchParams }: { params: { id: string }; searchParams?: { created?: string } }) {
  await requirePageAccess('website:read')
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) notFound()
  const s = (await getSession())!
  const write = can(s.user.role, 'website:write', s.overrides)
  const r = await getWebsitePost(id)
  if (r.state === 'ok' && !r.data) notFound()
  const p = r.state === 'ok' ? r.data! : null
  return (
    <>
      <PageHeader title={p ? p.title_he : 'Blog post'} description={p ? `/blog/${p.slug} · ${p.published ? 'published' : 'draft'}` : undefined} />
      <p className="mb-4 text-sm"><Link href="/website/blog" className="underline-offset-2 hover:underline">← Blog</Link></p>
      {searchParams?.created ? <p role="status" className="mb-3 text-sm text-ok">Post created.</p> : null}
      {r.state !== 'ok' ? (
        <SourceProblem result={r} what="Website blog post" />
      ) : p ? (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Post" meta={<Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} />} />
            <CardBody>
              {write ? (
                <BlogPostForm
                  p={{
                    id: p.id, updatedAt: p.updated_at, title_he: p.title_he, title_en: p.title_en ?? '', slug: p.slug, excerpt_he: p.excerpt_he ?? '',
                    content_he: p.content_he ?? '', cover_image: p.cover_image ?? '', images: p.images ?? [], category: p.category ?? '', tags: p.tags ?? [],
                    author: p.author ?? '', published: p.published, featured: p.featured,
                  }}
                />
              ) : (
                <div className="flex flex-col gap-2 text-sm">
                  {p.excerpt_he ? <p dir="rtl" className="text-muted">{p.excerpt_he}</p> : null}
                  <p dir="rtl" className="whitespace-pre-wrap break-words">{p.content_he || '—'}</p>
                </div>
              )}
            </CardBody>
          </Card>
          {write ? (
            <Card>
              <CardHeader title="Delete" />
              <CardBody><DeleteBlogPost id={p.id} updatedAt={p.updated_at} slug={p.slug} title={p.title_he} /></CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
