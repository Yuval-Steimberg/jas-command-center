'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import jsQR from 'jsqr'
import { Camera, CameraOff, Loader2 } from 'lucide-react'
import { scanAct } from '@/app/portal/scan/actions'

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }

/**
 * One box for every code in the shop: item labels (QR or barcode) and gift
 * cards (QR or printed code). Camera: the browser's own detector where it
 * exists (Chrome, Android: QR and barcodes), otherwise jsQR on camera frames
 * (Safari on iPhone: QR only, so an item's barcode is typed or scanned with
 * a USB/Bluetooth scanner, which types into the box).
 */
export function PortalScanner() {
  const router = useRouter()
  const [camera, setCamera] = useState<'off' | 'on' | 'unsupported'>('off')
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const video = useRef<HTMLVideoElement>(null)
  const input = useRef<HTMLInputElement>(null)

  const go = (code: string) => {
    if (!code.trim() || pending) return
    setMessage(null)
    start(async () => {
      const r = await scanAct(code).catch(() => ({ ok: false as const, message: 'החיבור נכשל. נסו שוב.' }))
      if (!r.ok) {
        setMessage(r.message)
        return
      }
      setCamera('off')
      if (r.external) window.location.assign(r.href)
      else router.push(r.href)
    })
  }

  useEffect(() => {
    if (camera !== 'on') return
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unsupported')
      return
    }
    const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
    const detector = Native ? new Native({ formats: ['qr_code', 'code_128'] }) : null
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    let stream: MediaStream | null = null
    let stop = false
    const read = async (v: HTMLVideoElement): Promise<string | null> => {
      if (detector) return (await detector.detect(v).catch(() => []))[0]?.rawValue ?? null
      if (!ctx || !v.videoWidth) return null
      const w = Math.min(640, v.videoWidth)
      const h = Math.round((v.videoHeight / v.videoWidth) * w)
      canvas.width = w
      canvas.height = h
      ctx.drawImage(v, 0, 0, w, h)
      return jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        stream = s
        const v = video.current
        if (!v || stop) return
        v.srcObject = s
        await v.play()
        while (!stop) {
          const found = await read(v)
          if (found) {
            if (input.current) input.current.value = found
            go(found)
            break
          }
          await new Promise((r) => setTimeout(r, 250))
        }
      })
      .catch(() => setCamera('unsupported'))
    return () => {
      stop = true
      stream?.getTracks().forEach((t) => t.stop())
    }
    // go() is stable enough for one camera session; restarting the camera on every render would flicker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera])

  return (
    <div className="flex flex-col gap-4">
      {camera === 'on' ? (
        <div className="flex flex-col gap-3">
          <video ref={video} muted playsInline className="aspect-[4/3] w-full rounded-lg bg-forest object-cover" />
          <button type="button" onClick={() => setCamera('off')} className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-line bg-surface px-5 text-base font-medium text-ink hover:bg-sunken">
            <CameraOff aria-hidden className="size-5" />
            עצירת המצלמה
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setCamera('on')} className="inline-flex min-h-16 items-center justify-center gap-2.5 rounded-lg bg-forest px-5 text-lg font-bold text-cream shadow-card hover:bg-forest/90">
          <Camera aria-hidden className="size-6" />
          פתיחת המצלמה
        </button>
      )}
      {camera === 'unsupported' ? <p className="text-sm text-warn">אין גישה למצלמה בדפדפן הזה (או שלא אישרתם גישה). אפשר להקליד את הקוד.</p> : null}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          go(input.current?.value ?? '')
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor="scan-code" className="text-sm text-muted">
          או מקלידים את הקוד מהמדבקה או מהשובר
        </label>
        <div className="flex gap-2">
          <input
            ref={input}
            id="scan-code"
            dir="ltr"
            autoComplete="off"
            autoCapitalize="characters"
            enterKeyHint="go"
            maxLength={300}
            placeholder="JAS-0042 / JAS-7F3K-QP2M-9"
            className="h-12 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-base text-ink focus:border-forest focus:outline-none"
          />
          <button type="submit" disabled={pending} className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-forest px-5 text-base font-bold text-cream hover:bg-forest/90 disabled:opacity-60">
            {pending ? <Loader2 aria-hidden className="size-5 animate-spin" /> : null}
            פתיחה
          </button>
        </div>
      </form>
      {message ? (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-base text-bad">
          {message}
        </p>
      ) : null}
    </div>
  )
}
