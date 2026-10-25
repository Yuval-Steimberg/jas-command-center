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
import type { PhotoFields } from '@/lib/inventory/ai-fields'
import { DIMENSION_KEYS, DIMENSION_LABELS, type Dimensions } from '@/lib/inventory/dimensions'
import { RENEWAL_LEVELS } from '@/lib/ops/types'
import { RENEWAL_LABEL, RENEWAL_LABEL_HE } from '@/lib/inventory/renewal'
import { DEFAULT_PLACE, PLACES, PLACE_LABEL, PLACE_LABEL_HE, type Place } from '@/lib/inventory/places'
import { ITEM_CATEGORIES } from '@/lib/inventory/categories'

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
 * upload let the AI suggest the fields (and again on request). Every suggestion is editable, and an
 * AI price stays "not approved" until a person ticks it.
 */
export function ItemForm({ lang, base, mode, initial, hidden = {}, locations, canWebsite = false, quantityEditable = true }: {
  lang: Lang
  base: '/inventory' | '/shop'
  mode: 'create' | 'edit'
  initial: ItemFormValues
  hidden?: Record<string, string | number>
  /** Create only: where the item goes (the four shop places, or any other location). */
  locations?: { id: string; label: string }[]
  /** Create only: the role may put the item on the website (inventory:write + website:write). */
  canWebsite?: boolean
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
  const [place, setPlace] = useState<Place>(DEFAULT_PLACE)
  const [placeOther, setPlaceOther] = useState('')
  const [onWebsite, setOnWebsite] = useState(false)
  const beforeRef = useRef<HTMLInputElement>(null)

  /**
   * Merge the AI's suggestion. `overwrite` = the person pressed the button and asked for it;
   * the automatic fill after an upload only fills what is still empty, so it never
   * replaces something a person already typed.
   */
  function applyAi(f: PhotoFields, overwrite: boolean) {
    const pick = (ai: string, cur: string) => (overwrite ? ai || cur : cur.trim() ? cur : ai)
    const cm = f.dimensionsCm
    const aiDims: Record<keyof typeof cm, string> = { length: cm.length != null ? String(cm.length) : '', width: cm.width != null ? String(cm.width) : '', height: cm.height != null ? String(cm.height) : '', diameter: cm.diameter != null ? String(cm.diameter) : '' }
    setV((x) => {
      const dims: Dimensions = { ...x.dims }
      for (const k of DIMENSION_KEYS) dims[k] = pick(aiDims[k], x.dims[k])
      return {
        ...x,
        title: pick(f.title, x.title),
        category: pick(f.category, x.category),
        colors: pick(f.colors.join(', '), x.colors),
        material: pick(f.material, x.material),
        description: pick(f.description, x.description),
        dims,
        // The asking price is never written by the AI: it is a suggestion until someone presses "approve".
        ...(f.suggestedPriceIls != null ? { aiPrice: String(f.suggestedPriceIls) } : {}),
      }
    })
    setNote(DIMENSION_KEYS.some((k) => aiDims[k]) ? `${t.aiDone} ${t.aiDims}` : t.aiDone)
  }

  async function describe(blob: Blob, overwrite: boolean) {
    setBusy('ai')
    try {
      const r = await describeItemPhotoAction(asForm(blob))
      if (!r.ok || !r.fields) throw new Error(r.message ?? 'The AI could not read the photo.')
      if (blobRef.current === blob) applyAi(r.fields, overwrite)
    } catch (e) {
      // Shown, never swallowed: an empty form with no reason is what this replaced.
      setError(`${t.aiFailed} ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy('')
    }
  }

  async function onPhoto(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setBusy('upload')
    setError('')
    setNote('')
    setSimilar([])
    let blob: Blob | null = null
    try {
      const prepared = await prepare(file)
      blob = prepared.blob
      blobRef.current = blob
      const [up, sim] = await Promise.all([uploadItemPhotoAction(asForm(blob)), similarPhotosAction(prepared.hash)])
      if (!up.ok || !up.url) throw new Error(up.message ?? 'Upload failed')
      set({ photoUrl: up.url, photoHash: prepared.hash })
      setSimilar(sim.items.filter((s) => !hidden.id || s.id !== hidden.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      blob = null
    } finally {
      setBusy('')
      for (const r of [camRef, galRef]) if (r.current) r.current.value = ''
    }
    // Fill the fields from the photo straight away, as intake always did; the button repeats it on demand.
    if (blob) await describe(blob, false)
  }

  async function fillFromPhoto() {
    if (!blobRef.current) return
    setError('')
    setNote('')
    await describe(blobRef.current, true)
  }

  async function onBefore(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setBusy('extra')
    setError('')
    try {
      const { blob } = await prepare(file)
      const up = await uploadItemPhotoAction(asForm(blob))
      if (!up.ok || !up.url) throw new Error(up.message ?? 'Upload failed')
      set({ beforePhotoUrl: up.url })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
      if (beforeRef.current) beforeRef.current.value = ''
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

  const chip = (on: boolean) => `inline-flex min-h-11 items-center justify-center rounded-md border px-3 text-center text-sm leading-tight transition-colors duration-150 ${on ? 'border-forest bg-forest font-semibold text-cream' : 'border-line hover:bg-sunken'}`
  const renewalLabels = lang === 'he' ? RENEWAL_LABEL_HE : RENEWAL_LABEL
  const placeLabels = lang === 'he' ? PLACE_LABEL_HE : PLACE_LABEL
  const priceSettled = v.priceApproved && !!v.price && v.price === v.aiPrice
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
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{t.beforePhoto}</p>
          <input type="hidden" name="beforePhotoUrl" value={v.beforePhotoUrl} />
          <input ref={beforeRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onBefore(e.target.files)} />
          {v.beforePhotoUrl ? (
            <span className="relative self-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.beforePhotoUrl} alt={t.beforePhoto} className="h-20 w-20 rounded-md border border-line object-cover" />
              <button type="button" data-compact aria-label={t.remove} onClick={() => set({ beforePhotoUrl: '' })} className="absolute -end-2 -top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface"><X aria-hidden className="h-4 w-4" /></button>
            </span>
          ) : (
            <button type="button" disabled={!!busy} onClick={() => beforeRef.current?.click()} className="grid h-20 w-20 place-items-center rounded-md border border-dashed border-line text-muted hover:bg-sunken" aria-label={t.beforePhoto}><ImagePlus aria-hidden className="h-5 w-5" /></button>
          )}
        </div>
        {error ? <p role="status" dir="auto" className="text-sm text-bad">{error}</p> : null}
        {note ? <p role="status" className="text-sm text-ok">{note}</p> : null}
      </section>

      <section className="grid gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2">
        {field(t.title, <input name="title" required value={v.title} onChange={(e) => set({ title: e.target.value })} dir="auto" maxLength={200} className={input} />, true)}
        {field(t.category, (
          <>
            {/* An older item's category off the list stays selectable until someone picks a new one. */}
            <input type="hidden" name="categoryWas" value={initial.category} />
            <select name="category" value={v.category} onChange={(e) => set({ category: e.target.value })} className={input}>
              <option value="">—</option>
              {initial.category && !(ITEM_CATEGORIES as readonly string[]).includes(initial.category) ? <option value={initial.category}>{initial.category}</option> : null}
              {ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </>
        ))}
        {field(t.colors, <input name="colors" value={v.colors} onChange={(e) => set({ colors: e.target.value })} dir="auto" maxLength={200} className={input} />)}
        {field(t.material, <input name="material" value={v.material} onChange={(e) => set({ material: e.target.value })} dir="auto" maxLength={200} className={input} />)}
        <fieldset className="flex min-w-0 flex-col gap-1 text-sm sm:col-span-2">
          <legend className="mb-1 text-muted">{t.dimensions} ({t.dimsUnit})</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {DIMENSION_KEYS.map((k) => (
              <label key={k} className="flex min-w-0 flex-col gap-1"><span className="text-muted">{DIMENSION_LABELS[k][lang]}</span>
                <input name={`dim${k.charAt(0).toUpperCase()}${k.slice(1)}`} value={v.dims[k]} onChange={(e) => set({ dims: { ...v.dims, [k]: e.target.value } })} inputMode="decimal" dir="ltr" maxLength={8} className={input} />
              </label>
            ))}
          </div>
          {v.dims.note ? (
            <label className="mt-1 flex min-w-0 flex-col gap-1"><span className="text-muted">{t.dimsNote}</span>
              <input name="dimNote" value={v.dims.note} onChange={(e) => set({ dims: { ...v.dims, note: e.target.value } })} dir="auto" maxLength={200} className={input} />
            </label>
          ) : <input type="hidden" name="dimNote" value="" />}
        </fieldset>
        <fieldset className="flex min-w-0 flex-col gap-1 text-sm sm:col-span-2">
          <legend className="mb-1 text-muted">{t.renewal}</legend>
          <input type="hidden" name="renewalLevel" value={v.renewal} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {RENEWAL_LEVELS.map((n) => (
              <button key={n} type="button" aria-pressed={v.renewal === String(n)} onClick={() => set({ renewal: v.renewal === String(n) ? '' : String(n) })} className={chip(v.renewal === String(n))}>
                <span dir="ltr">{n}</span>&nbsp;·&nbsp;{renewalLabels[n]}
              </button>
            ))}
          </div>
        </fieldset>
        {quantityEditable ? field(t.quantity, <input name="quantity" type="number" min={mode === 'create' ? 1 : 0} max={10000} value={v.quantity} onChange={(e) => set({ quantity: e.target.value })} dir="ltr" className={input} />) : null}
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <label className="flex flex-col gap-1"><span className="text-muted">{t.askingPrice}</span>
            {/* A price a person types is their price, so it counts as approved. */}
            <input name="price" value={v.price} onChange={(e) => set({ price: e.target.value, priceApproved: true })} inputMode="decimal" dir="ltr" className={input} />
          </label>
          {v.aiPrice && !priceSettled ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted">{t.suggested} <span dir="ltr">₪{v.aiPrice}</span></span>
              <button type="button" onClick={() => set({ price: v.aiPrice, priceApproved: true })} className={chip(false)}>{t.approvePrice}</button>
            </div>
          ) : null}
          {v.aiPrice && priceSettled ? <p className="text-sm text-ok">{t.priceApprovedNote}</p> : null}
          {!v.priceApproved && v.price ? <p className="text-sm text-warn">{t.priceNotApproved}</p> : null}
        </div>
        {locations ? (
          <fieldset className="flex min-w-0 flex-col gap-1 text-sm sm:col-span-2">
            <legend className="mb-1 text-muted">{t.location}</legend>
            <input type="hidden" name="place" value={place} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PLACES.map((p) => (
                <button key={p} type="button" aria-pressed={place === p} onClick={() => setPlace(p)} className={chip(place === p)}>{placeLabels[p]}</button>
              ))}
            </div>
            {place === 'other' ? (
              <>
                <input name="placeOther" value={placeOther} onChange={(e) => setPlaceOther(e.target.value)} list="item-form-locations" required dir="auto" maxLength={100} aria-label={t.otherLocation} placeholder={t.otherLocation} className={`${input} mt-1`} />
                <datalist id="item-form-locations">{locations.map((l) => <option key={l.id} value={l.label} />)}</datalist>
              </>
            ) : null}
          </fieldset>
        ) : null}
        {field(t.origin, <input name="origin" value={v.origin} onChange={(e) => set({ origin: e.target.value })} dir="auto" maxLength={500} placeholder={t.optional} className={input} />, true)}
        {mode === 'create' && canWebsite ? (
          <fieldset className="flex min-w-0 flex-col gap-1 text-sm sm:col-span-2">
            <legend className="mb-1 text-muted">{t.onWebsite}</legend>
            <input type="hidden" name="onWebsite" value={onWebsite ? 'yes' : 'no'} />
            <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
              <button type="button" aria-pressed={onWebsite} onClick={() => setOnWebsite(true)} className={chip(onWebsite)}>{t.yes}</button>
              <button type="button" aria-pressed={!onWebsite} onClick={() => setOnWebsite(false)} className={chip(!onWebsite)}>{t.no}</button>
            </div>
            {onWebsite ? <p className="text-xs text-muted">{t.onWebsiteHint}</p> : null}
          </fieldset>
        ) : null}
        {field(t.description, <textarea name="description" value={v.description} onChange={(e) => set({ description: e.target.value })} dir="auto" rows={3} maxLength={2000} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" />, true)}
        {field(t.notes, <textarea name="notes" value={v.notes} onChange={(e) => set({ notes: e.target.value })} dir="auto" rows={2} maxLength={2000} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" />, true)}
      </section>

      <div className="flex flex-col gap-2 [&_button]:h-12 [&_button]:min-w-48 [&_button]:text-base">
        <Submit label={mode === 'create' ? t.save : lang === 'he' ? 'שמירה' : 'Save'} busy={mode === 'create' ? t.saving : lang === 'he' ? 'שומר…' : 'Saving…'} tone="primary" />
        <Outcome state={state} />
      </div>
    </form>
  )
}
