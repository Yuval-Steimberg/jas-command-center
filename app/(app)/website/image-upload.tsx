'use client'

import { useRef, useState } from 'react'
import { uploadImageAction } from './media-actions'
import type { ImageFolder } from '@/lib/integrations/website/manage'

const MAX_EDGE = 1600

/** Downscale on the device (as the website manager does) and encode WebP, JPEG where WebP is unsupported. */
async function resize(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const encode = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.82))
  const webp = await encode('image/webp')
  if (webp?.type === 'image/webp') return webp
  const jpeg = await encode('image/jpeg')
  if (!jpeg) throw new Error('This browser could not prepare the photo.')
  return jpeg
}

/**
 * A button that uploads a photo to the website's storage and hands back its
 * link. Nothing on the site changes until the surrounding form is saved.
 */
export function ImageUpload({ folder, onUploaded, label = 'Upload photo', multiple = false }: { folder: ImageFolder; onUploaded: (url: string) => void; label?: string; multiple?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError('')
    try {
      for (const file of Array.from(files)) {
        const blob = await resize(file)
        const f = new FormData()
        f.set('folder', folder)
        f.set('file', blob, `photo.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`)
        const res = await uploadImageAction(f)
        if (!res.ok || !res.url) throw new Error(res.message ?? 'Upload failed')
        onUploaded(res.url)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (ref.current) ref.current.value = ''
    }
  }
  return (
    <span className="flex flex-col gap-1">
      <input ref={ref} type="file" accept="image/*" multiple={multiple} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void upload(e.target.files)} />
      <button type="button" disabled={busy} onClick={() => ref.current?.click()} className="h-10 w-fit rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken disabled:opacity-60">
        {busy ? 'Uploading…' : label}
      </button>
      {error ? <span role="status" className="text-xs text-bad">{error}</span> : null}
    </span>
  )
}
