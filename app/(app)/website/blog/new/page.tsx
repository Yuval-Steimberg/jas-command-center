import Link from 'next/link'
import { Card, CardBody, PageHeader } from '@/components/ui/card'
import { requirePageAccess } from '@/lib/auth/session'
import { BlogPostForm } from '../../blog-forms'

export const dynamic = 'force-dynamic'

export default async function NewBlogPostPage() {
  await requirePageAccess('website:write')
  return (
    <>
      <PageHeader title="New blog post" description="Saved straight to the website. Leave Published unticked to keep it as a draft." />
      <p className="mb-4 text-sm"><Link href="/website/blog" className="underline-offset-2 hover:underline">← Blog</Link></p>
      <Card>
        <CardBody>
          <BlogPostForm p={{ title_he: '', title_en: '', slug: '', excerpt_he: '', content_he: '', cover_image: '', images: [], category: '', tags: [], author: 'צוות JAS', published: false, featured: false }} />
        </CardBody>
      </Card>
    </>
  )
}
