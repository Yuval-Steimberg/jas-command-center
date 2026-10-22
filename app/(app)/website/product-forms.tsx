'use client'

import { useState } from 'react'
import { useFormState } from 'react-dom'
import { createCategoryAction, deleteProductAction, saveProductAction, setLowStockAction, type ActionState } from './actions'
import { Result, Submit, input } from './forms'

const area = 'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm'
const CONDITION_LABELS: Record<string, string> = { excellent: 'מצוין · excellent', good: 'טוב · good', fair: 'סביר · fair', 'as-is': 'כמו שהוא · as-is' }

export interface ProductValues {
  id?: number
  updatedAt?: string
  name_he: string
  name_en: string
  slug: string
  description_he: string
  description_en: string
  story_he: string
  story_en: string
  price: string
  original_price: string
  category_id: string
  condition: string
  style: string
  dimensions: string
  material: string
  origin: string
  image_url: string
  images: string[]
  featured: boolean
  quantity: string
  tags: string[]
  /** null = the website has no published column yet. */
  published: boolean | null
}

/** The manager's autoSlug: from the English name, lowercase, dashes. A Hebrew-only name needs a typed slug. */
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60)
}

export function FullProductForm({ p, categories }: { p: ProductValues; categories: { id: number; name_he: string }[] }) {
  const [state, action] = useFormState<ActionState, FormData>(saveProductAction, {})
  const [slug, setSlug] = useState(p.slug)
  const [slugTouched, setSlugTouched] = useState(!!p.id)
  const [image, setImage] = useState(p.image_url)
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const f = new FormData(e.currentTarget)
        const live = p.published === null ? true : f.get('published') === 'on'
        const msg = !p.id
          ? live ? 'Create this product and show it in the shop?' : 'Create this product as a draft (not shown in the shop)?'
          : p.published !== null && live && !p.published ? 'Publish this product in the shop?'
          : p.published && !live ? 'Take this product out of the shop (back to draft)?'
          : `Save changes to "${p.name_he}" on the live shop?`
        if (!window.confirm(msg)) e.preventDefault()
      }}
      className="flex flex-col gap-4"
    >
      {p.id ? <input type="hidden" name="id" value={p.id} /> : null}
      {p.updatedAt ? <input type="hidden" name="expectUpdatedAt" value={p.updatedAt} /> : null}
      <input type="hidden" name="was_slug" value={p.slug} />
      <input type="hidden" name="was_price" value={p.price} />
      <input type="hidden" name="was_quantity" value={p.quantity} />
      <input type="hidden" name="was_published" value={String(p.published)} />
      {p.published !== null ? <input type="hidden" name="hasPublished" value="1" /> : null}

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Names and address</legend>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Name (Hebrew) *</span>
          <input name="name_he" defaultValue={p.name_he} required maxLength={200} dir="rtl" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Name (English)</span>
          <input name="name_en" defaultValue={p.name_en} maxLength={200} dir="ltr" onChange={(e) => { if (!slugTouched) setSlug(slugify(e.target.value)) }} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2"><span className="text-muted">Address *</span>
          <span className="flex items-center gap-1" dir="ltr">
            <span className="text-sm text-muted">/product/</span>
            <input name="slug" value={slug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value) }} required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="teak-armchair" className={input} />
          </span>
          {p.id ? <span className="text-xs text-muted">Changing the address breaks existing links and shares of this product.</span> : null}
        </label>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold">Price and stock</legend>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Price ₪ *</span>
          <input name="price" defaultValue={p.price} required inputMode="decimal" dir="ltr" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Strike-through ₪</span>
          <input name="original_price" defaultValue={p.original_price} inputMode="decimal" dir="ltr" placeholder="none" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Quantity *</span>
          <input name="quantity" defaultValue={p.quantity} required inputMode="numeric" dir="ltr" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Condition</span>
          <select name="condition" defaultValue={p.condition || 'good'} className="h-10 rounded-md border border-line bg-surface px-2 text-sm">
            {Object.entries(CONDITION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <p className="text-xs text-muted sm:col-span-4">Quantity 0 shows the product as out of stock, as in the website&apos;s form.</p>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Images</legend>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Main image link *</span>
          <input name="image_url" value={image} onChange={(e) => setImage(e.target.value)} required maxLength={2000} dir="ltr" placeholder="https://… or /images/…" className={input} />
          {/^(https:\/\/|\/[^/])/.test(image) ? (
            // eslint-disable-next-line @next/next/no-img-element -- a preview of an arbitrary external link
            <img src={image} alt="" className="mt-1 h-24 w-24 rounded-md border border-line object-cover" />
          ) : null}
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Gallery images (one link per line)</span>
          <textarea name="images" defaultValue={p.images.join('\n')} rows={4} dir="ltr" className={area} />
        </label>
        <p className="text-xs text-muted sm:col-span-2">Uploading a new photo still happens in the website&apos;s storage; paste its link here.</p>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Descriptions</legend>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Description (Hebrew)</span>
          <textarea name="description_he" defaultValue={p.description_he} maxLength={10000} rows={5} dir="rtl" className={area} />
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Description (English)</span>
          <textarea name="description_en" defaultValue={p.description_en} maxLength={10000} rows={5} dir="ltr" className={area} />
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">The item&apos;s story (Hebrew)</span>
          <textarea name="story_he" defaultValue={p.story_he} maxLength={10000} rows={4} dir="rtl" className={area} />
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">The item&apos;s story (English)</span>
          <textarea name="story_en" defaultValue={p.story_en} maxLength={10000} rows={4} dir="ltr" className={area} />
        </label>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">Details</legend>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Category</span>
          <select name="category_id" defaultValue={p.category_id} className="h-10 rounded-md border border-line bg-surface px-2 text-sm">
            <option value="">No category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name_he}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Style</span><input name="style" defaultValue={p.style} maxLength={100} dir="auto" className={input} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Dimensions</span><input name="dimensions" defaultValue={p.dimensions} maxLength={200} dir="auto" className={input} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Material</span><input name="material" defaultValue={p.material} maxLength={200} dir="auto" className={input} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Origin</span><input name="origin" defaultValue={p.origin} maxLength={200} dir="auto" className={input} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Tags (comma-separated)</span><input name="tags" defaultValue={p.tags.join(', ')} dir="auto" className={input} /></label>
      </fieldset>

      <div className="flex flex-wrap gap-4">
        {p.published !== null ? <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="published" defaultChecked={p.published} className="h-4 w-4" /> Published in the shop</label> : null}
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="featured" defaultChecked={p.featured} className="h-4 w-4" /> Featured on the home page</label>
      </div>
      <div><Submit label={p.id ? 'Save product' : 'Create product'} busy="Saving…" tone="primary" /></div>
      <Result state={state} />
    </form>
  )
}

export function AddCategoryForm() {
  const [state, action] = useFormState<ActionState, FormData>(createCategoryAction, {})
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm"><span className="text-muted">New category (Hebrew) *</span><input name="name_he" required maxLength={100} dir="rtl" className={input} /></label>
        <label className="flex flex-1 flex-col gap-1 text-sm"><span className="text-muted">English name</span><input name="name_en" maxLength={100} dir="ltr" className={input} /></label>
        <Submit label="Add category" busy="Adding…" />
      </div>
      <Result state={state} />
    </form>
  )
}

export function LowStockForm({ threshold }: { threshold: number }) {
  const [state, action] = useFormState<ActionState, FormData>(setLowStockAction, {})
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="was" value={threshold} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Flag products with this many or fewer in stock</span>
          <input name="threshold" defaultValue={threshold} inputMode="numeric" dir="ltr" className={`${input} w-28`} />
        </label>
        <Submit label="Save" busy="Saving…" />
      </div>
      <Result state={state} />
    </form>
  )
}

export function DeleteProduct({ id, updatedAt, slug, name }: { id: number; updatedAt: string; slug: string; name: string }) {
  const [state, action] = useFormState<ActionState, FormData>(deleteProductAction, {})
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Delete "${name}" from the shop permanently? This cannot be undone. To hide it but keep it, untick "Published" instead.`)) e.preventDefault()
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="expectUpdatedAt" value={updatedAt} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="name" value={name} />
      <div><button className="h-10 rounded-full border border-line px-4 text-sm font-medium text-bad hover:bg-sunken">Delete product</button></div>
      <Result state={state} />
    </form>
  )
}
