'use client'

import { useState } from 'react'
import { useFormState } from 'react-dom'
import { deleteBlogPostAction, saveBlogPostAction, type ActionState } from './actions'
import { Result, Submit, input } from './forms'

const area = 'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm'

export interface BlogPostValues {
  id?: number
  updatedAt?: string
  title_he: string
  title_en: string
  slug: string
  excerpt_he: string
  content_he: string
  cover_image: string
  images: string[]
  category: string
  tags: string[]
  author: string
  published: boolean
  featured: boolean
}

/** The manager's slugify: lowercase, word characters and dashes. Hebrew titles need a typed slug. */
function slugify(s: string) {
  return s.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60)
}

export function BlogPostForm({ p }: { p: BlogPostValues }) {
  const [state, action] = useFormState<ActionState, FormData>(saveBlogPostAction, {})
  const [slug, setSlug] = useState(p.slug)
  const [slugTouched, setSlugTouched] = useState(!!p.id)
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const f = new FormData(e.currentTarget)
        const live = f.get('published') === 'on'
        const msg = !p.id
          ? live ? 'Create and publish this post on the live blog?' : 'Create this post as a draft?'
          : live && !p.published ? 'Publish this post on the live blog?'
          : !live && p.published ? 'Take this post off the blog (back to draft)?'
          : 'Save changes to this post?'
        if (!window.confirm(msg)) e.preventDefault()
      }}
      className="flex flex-col gap-3"
    >
      {p.id ? <input type="hidden" name="id" value={p.id} /> : null}
      {p.updatedAt ? <input type="hidden" name="expectUpdatedAt" value={p.updatedAt} /> : null}
      <input type="hidden" name="wasPublished" value={String(p.published)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Title (Hebrew) *</span>
          <input name="title_he" defaultValue={p.title_he} required maxLength={200} dir="rtl" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Title (English)</span>
          <input
            name="title_en"
            defaultValue={p.title_en}
            maxLength={200}
            dir="ltr"
            onChange={(e) => { if (!slugTouched) setSlug(slugify(e.target.value)) }}
            className={input}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Address *</span>
        <span className="flex items-center gap-1" dir="ltr">
          <span className="text-sm text-muted">/blog/</span>
          <input name="slug" value={slug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value) }} required maxLength={80} pattern="[a-z0-9_]+(-[a-z0-9_]+)*" placeholder="how-to-restore-wood" className={input} />
        </span>
        {p.id && p.published ? <span className="text-xs text-muted">Changing the address of a published post breaks existing links to it.</span> : null}
      </label>
      <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Excerpt</span>
        <textarea name="excerpt_he" defaultValue={p.excerpt_he} maxLength={1000} rows={2} dir="rtl" className={area} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Article</span>
        <span className="text-xs text-muted">Formatting: <code>## heading</code>, <code>### subheading</code>, <code>- list item</code>, <code>1. numbered</code>, <code>&gt; quote</code>, <code>**bold**</code>, <code>[text](/path)</code>. A blank line starts a new paragraph.</span>
        <textarea name="content_he" defaultValue={p.content_he} maxLength={60000} rows={18} dir="rtl" className={area} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Cover image link</span>
          <input name="cover_image" defaultValue={p.cover_image} maxLength={2000} dir="ltr" placeholder="https://… or /images/…" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Gallery images (one link per line)</span>
          <textarea name="images" defaultValue={p.images.join('\n')} rows={3} dir="ltr" className={area} />
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Category</span>
          <input name="category" defaultValue={p.category} maxLength={60} dir="auto" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Tags (comma-separated)</span>
          <input name="tags" defaultValue={p.tags.join(', ')} dir="auto" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Author</span>
          <input name="author" defaultValue={p.author} maxLength={80} dir="auto" className={input} />
        </label>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="published" defaultChecked={p.published} className="h-4 w-4" /> Published on the blog</label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="featured" defaultChecked={p.featured} className="h-4 w-4" /> Featured</label>
      </div>
      <div><Submit label={p.id ? 'Save post' : 'Create post'} busy="Saving…" tone="primary" /></div>
      <Result state={state} />
    </form>
  )
}

export function DeleteBlogPost({ id, updatedAt, slug, title }: { id: number; updatedAt: string; slug: string; title: string }) {
  const [state, action] = useFormState<ActionState, FormData>(deleteBlogPostAction, {})
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Delete "${title}" permanently? This cannot be undone. To take it off the site but keep it, untick "Published" instead.`)) e.preventDefault()
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="expectUpdatedAt" value={updatedAt} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="title" value={title} />
      <div><button className="h-10 rounded-full border border-line px-4 text-sm font-medium text-bad hover:bg-sunken">Delete post</button></div>
      <Result state={state} />
    </form>
  )
}
