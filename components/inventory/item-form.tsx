'use client'

import { useRef, useState } from 'react'
import { useFormState } from 'react-dom'
import Link from 'next/link'
import { Camera, ImagePlus, Sparkles, X } from 'lucide-react'
import { Submit, input } from '@/app/(app)/website/forms'
import { Outcome } from '@/app/(app)/inventory/forms'
import { createItemAction, editItemAction } from '@/app/(app)/inventory/actions'
import { describeItemPhotoAction, similarPhotosAction, uploadItemPhotoAction, type SimilarItem } from '@/app/(app)/inventory/photo-actions'
import type { ActionState } from '@/lib/ops/act'
import { HASH_H, HASH_W, differenceHash, toGrey } from '@/lib/inventory/photo-hash'
import { COPY, type Lang } from '@/components/sales/copy'
import type { ItemFormValues } from './item-values'

const MAX_EDGE = 1600

/** Downscale on the device and encode WebP (JPEG where WebP is unsupported); also return the photo's difference hash. */
async function prepare(file: File): Promise<{ blob: Blob; hash: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const tiny = document.createElement('canvas')
  tiny.width = HASH_W
  tiny.height = HASH_H
  const tctx = tiny.getContext('2d', { willReadFrequently: true })!
  tctx.drawImage(bitmap, 0, 0, HASH_W, HASH_H)
  const hash = differenceHash(toGrey(tctx.getImageData(0, 0, HASH_W, HASH_H).data))
  bitmap.close()
  const encode = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.82))
  const webp = await encode('image/webp')
  if (webp?.type === 'image/webp') return { blob: webp, hash }
  const jpeg = await encode('image/jpeg')
  if (!jpeg) throw new Error('This browser could not prepare the photo.')
  return { blob: jpeg, hash }
}
const asForm = (blob: Blob) => {
  const f = new FormData()
  f.set('file', blob, `photo.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`)
  return f
}

/**
 * Add or edit an item from its photo: take or pick a photo (resized on the
 * phone), upload it, warn if it looks like an item we already have, and on
 * request let the AI suggest the fields. Every suggestion is editable, and an
 * AI price stays "not approved" until a person ticks it.
 */
export function ItemForm({ lang, base, mode, initial, hidden = {}, conditions, locations, defaultLocation, canCost, quantityEditable = true }: {
  lang: Lang
  base: '/inventory' | '/shop'
  mode: 'create' | 'edit'
  initial: ItemFormValues
  hidden?: Record<string, string | number>
  conditions: { value: string; label: string }[]
  locations?: { id: string; label: string }[]
  defaultLocation?: string | null
  canCost: boolean
  quantityEditable?: boolean
}) {
  const t = COPY[lang]
  const [v, setV] = useState(initial)
  const set = (patch: Partial<ItemFormValues>) => setV((x) => ({ ...x, ...patch }))
  const [state, run] = useFormState<ActionState, FormData>(mode === 'create' ? createItemAction : editItemAction, {})
  const [busy, setBusy] = useState<'' | 'upload' | 'ai' | 'extra'>('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [similar, setSimilar] = useState<SimilarItem[]>([])
  const blobRef = useRef<Blob | null>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const extraRef = useRef<HTMLInputElement>(null)

  async function onPhoto(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setBusy('upload')
    setError('')
    setNote('')
    setSimilar([])
    try {
      const { blob, hash } = await prepare(file)
      blobRef.current = blob
      const [up, sim] = await Promise.all([uploadItemPhotoAction(asForm(blob)), similarPhotosAction(hash)])
      if (!up.ok || !up.url) throw new Error(up.message ?? 'Upload failed')
      set({ photoUrl: up.url, photoHash: hash })
      setSimilar(sim.items.filter((s) => !hidden.id || s.id !== hidden.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
      for (const r of [camRef, galRef]) if (r.current) r.current.value = ''
    }
  }

  async function fillFromPhoto() {
    if (!blobRef.current) return
    setBusy('ai')
    setError('')
    try {
      const r = await describeItemPhotoAction(asForm(blobRef.current))
      if (!r.ok || !r.fields) throw new Error(r.message ?? 'The AI could not read the photo.')
      const f = r.fields
      setV((x) => ({
        ...x,
        title: f.title || x.title,
        category: f.category || x.category,
        colors: f.colors.length ? f.colors.join(', ') : x.colors,
        material: f.material || x.material,
        description: f.description || x.description,
        ...(f.suggestedPriceIls != null ? { aiPrice: String(f.suggestedPriceIls), price: x.price || String(f.suggestedPriceIls), priceApproved: x.price ? x.priceApproved : false } : {}),
      }))
      setNote(t.aiDone)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  async function onExtra(files: FileList | null) {
    if (!files?.length) return
    setBusy('extra')
    setError('')
    try {
      for (const file of Array.from(files).slice(0, 12 - v.extraPhotos.length)) {
        const { blob } = await prepare(file)
        const up = await uploadItemPhotoAction(asForm(blob))
        if (!up.ok || !up.url) throw new Error(up.message ?? 'Upload failed')
        setV((x) => ({ ...x, extraPhotos: [...x.extraPhotos, up.url!].slice(0, 12) }))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
      if (extraRef.current) extraRef.current.value = ''
    }
  }

  const pill = 'inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken disabled:opacity-60'
  const field = (label: string, el: React.ReactNode, wide = false) => (
    <label className={`flex min-w-0 flex-col gap-1 text-sm ${wide ? 'sm:col-span-2' : ''}`}><span className="text-muted">{label}</span>{el}</label>
  )

  return (
    <form action={run} className="flex flex-col gap-4">
      {Object.entries(hidden).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
      <input type="hidden" name="base" value={base} />
      <input type="hidden" name="photoUrl" value={v.photoUrl} />
      <input type="hidden" name="photoHash" value={v.photoHash} />
      <input type="hidden" name="aiPrice" value={v.aiPrice} />
      <input type="hidden" name="priceApproved" value={String(v.priceApproved)} />
      <input type="hidden" name="extraPhotosSent" value="1" />
      {v.extraPhotos.map((u) => <input key={u} type="hidden" name="extraPhoto" value={u} />)}

      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3">
        <h2 className="text-sm font-semibold text-ink">{t.photo}</h2>
        <div className="flex flex-wrap items-start gap-3">
          {v.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.photoUrl} alt="" className="h-32 w-32 rounded-md border border-line object-cover" />
          ) : <div className="grid h-32 w-32 place-items-center rounded-md border border-dashed border-line text-xs text-muted">{t.photo}</div>}
          <div className="flex flex-col gap-2">
            <input ref={camRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onPhoto(e.target.files)} />
            <input ref={galRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onPhoto(e.target.files)} />
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!!busy} onClick={() => camRef.current?.click()} className={pill}><Camera aria-hidden className="h-4 w-4" />{t.camera}</button>
              <button type="button" disabled={!!busy} onClick={() => galRef.current?.click()} className={pill}><ImagePlus aria-hidden className="h-4 w-4" />{t.gallery}</button>
            </div>
            <button type="button" disabled={!!busy || !blobRef.current} onClick={() => void fillFromPhoto()} className={pill}><Sparkles aria-hidden className="h-4 w-4" />{busy === 'ai' ? t.aiBusy : t.aiFill}</button>
            {busy === 'upload' ? <p className="text-sm text-muted">{t.uploading}</p> : null}
          </div>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">{t.photoLink}</summary>
          <input value={v.photoUrl} onChange={(e) => set({ photoUrl: e.target.value.trim(), photoHash: '' })} dir="ltr" maxLength={2000} placeholder="https://" aria-label={t.photoLink} className={`${input} mt-2`} />
        </details>
        {similar.length ? (
          <div role="status" className="rounded-md border border-warn/50 bg-warn/5 p-2 text-sm">
            <p className="font-medium text-warn">{t.dupTitle}</p>
            <ul className="mt-2 flex flex-col gap-2">
              {similar.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {s.photoUrl ? <img src={s.photoUrl} alt="" className="h-12 w-12 rounded object-cover" /> : null}
                  <span className="min-w-0 flex-1 truncate" dir="auto"><span dir="ltr">{s.sku}</span> · {s.title} · {s.status.replace('_', ' ')}</span>
                  <Link href={base === '/shop' ? `/shop/items/${s.id}` : `/inventory/${s.id}`} className="underline underline-offset-2">{t.dupSame}</Link>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setSimilar([])} className="mt-2 text-sm underline underline-offset-2">{t.dupNew}</button>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{t.morePhotos}</p>
          <div className="flex flex-wrap gap-2">
            {v.extraPhotos.map((u) => (
              <span key={u} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" className="h-20 w-20 rounded-md border border-line object-cover" />
                <button type="button" data-compact aria-label={t.remove} onClick={() => set({ extraPhotos: v.extraPhotos.filter((x) => x !== u) })} className="absolute -end-2 -top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface"><X aria-hidden className="h-4 w-4" /></button>
              </span>
            ))}
            {v.extraPhotos.length < 12 ? (
              <>
                <input ref={extraRef} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onExtra(e.target.files)} />
                <button type="button" disabled={!!busy} onClick={() => extraRef.current?.click()} className="grid h-20 w-20 place-items-center rounded-md border border-dashed border-line text-muted hover:bg-sunken" aria-label={t.morePhotos}>{busy === 'extra' ? '…' : <ImagePlus aria-hidden className="h-5 w-5" />}</button>
              </>
            ) : null}
          </div>
        </div>
        {error ? <p role="status" dir="auto" className="text-sm text-bad">{error}</p> : null}
        {note ? <p role="status" className="text-sm text-ok">{note}</p> : null}
      </section>

      <section className="grid gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2">
        {field(t.title, <input name="title" required value={v.title} onChange={(e) => set({ title: e.target.value })} dir="auto" maxLength={200} className={input} />, true)}
        {field(t.category, <input name="category" value={v.category} onChange={(e) => set({ category: e.target.value })} dir="auto" maxLength={100} className={input} />)}
        {field(t.colors, <input name="colors" value={v.colors} onChange={(e) => set({ colors: e.target.value })} dir="auto" maxLength={200} className={input} />)}
        {field(t.material, <input name="material" value={v.material} onChange={(e) => set({ material: e.target.value })} dir="auto" maxLength={200} className={input} />)}
        {field(t.dimensions, <input name="dimensions" value={v.dimensions} onChange={(e) => set({ dimensions: e.target.value })} dir="auto" maxLength={200} className={input} />)}
        {field(t.condition, <select name="condition" value={v.condition} onChange={(e) => set({ condition: e.target.value })} className={input}>{mode === 'edit' ? <option value="">—</option> : null}{conditions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>)}
        {quantityEditable ? field(t.quantity, <input name="quantity" type="number" min={mode === 'create' ? 1 : 0} max={10000} value={v.quantity} onChange={(e) => set({ quantity: e.target.value })} dir="ltr" className={input} />) : null}
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <label className="flex flex-col gap-1"><span className="text-muted">{t.askingPrice}</span>
            <input name="price" value={v.price} onChange={(e) => set({ price: e.target.value })} inputMode="decimal" dir="ltr" className={input} />
          </label>
          {v.aiPrice ? (
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={v.priceApproved} onChange={(e) => set({ priceApproved: e.target.checked })} className="h-5 w-5" />
              <span>{t.approve}</span><span className="text-xs text-muted">· {t.estimate} ₪{v.aiPrice}</span>
            </label>
          ) : null}
        </div>
        {canCost ? field(t.cost, <input name="cost" value={v.cost} onChange={(e) => set({ cost: e.target.value })} inputMode="decimal" dir="ltr" className={input} />) : null}
        {locations ? field(t.location, (
          <select name="locationId" defaultValue={defaultLocation ?? ''} className={input}>
            <option value="">—</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        )) : null}
        {mode === 'create' ? field(t.source, <input name="note" dir="auto" maxLength={500} className={input} />) : null}
        {field(t.description, <textarea name="description" value={v.description} onChange={(e) => set({ description: e.target.value })} dir="auto" rows={3} maxLength={2000} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" />, true)}
      </section>

      <div className="flex flex-col gap-2 [&_button]:h-12 [&_button]:min-w-48 [&_button]:text-base">
        <Submit label={mode === 'create' ? t.save : lang === 'he' ? 'שמירה' : 'Save'} busy={mode === 'create' ? t.saving : lang === 'he' ? 'שומר…' : 'Saving…'} tone="primary" />
        <Outcome state={state} />
      </div>
    </form>
  )
}
