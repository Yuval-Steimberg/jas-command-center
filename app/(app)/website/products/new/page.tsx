import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { SourceProblem } from '@/components/ui/source-state'
import { requirePageAccess } from '@/lib/auth/session'
import { getWebsiteProductMeta } from '@/lib/integrations/website/manage'
import { AddCategoryForm, FullProductForm } from '../../product-forms'

export const dynamic = 'force-dynamic'

export default async function NewProductPage() {
  await requirePageAccess('website:write')
  const meta = await getWebsiteProductMeta()
  return (
    <>
      <PageHeader title="New product" description="Saved straight to the website shop, with the website product form's rules. Untick Published to keep it as a draft." />
      <p className="mb-4 text-sm"><Link href="/website/products" className="underline-offset-2 hover:underline">← Products</Link></p>
      {meta.state !== 'ok' ? (
        <SourceProblem result={meta} what="Website product categories" />
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardBody>
              <FullProductForm
                categories={meta.data.categories}
                p={{
                  name_he: '', name_en: '', slug: '', description_he: '', description_en: '', story_he: '', story_en: '', price: '', original_price: '', category_id: '',
                  condition: 'good', style: '', dimensions: '', material: '', origin: '', image_url: '', images: [], featured: false, quantity: '1', tags: [], published: true,
                }}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Categories" />
            <CardBody><AddCategoryForm /></CardBody>
          </Card>
        </div>
      )}
    </>
  )
}
