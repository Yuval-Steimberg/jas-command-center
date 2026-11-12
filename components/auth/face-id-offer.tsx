'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ScanFace, X } from 'lucide-react'
import { biometricName, hasBuiltInUnlock, passkeyOnDevice } from '@/lib/auth/passkey-browser'

const KEY = 'jas-face-id-offer-dismissed'

/**
 * A quiet card offering Face ID, shown only to someone with no passkey yet, on
 * a device that actually has Face ID / a fingerprint reader, until they tap ✕.
 * The dismissal is a preference on this device only.
 */
export function FaceIdOffer() {
  const [show, setShow] = useState(false)
  const [name, setName] = useState('Face ID')

  useEffect(() => {
    let dismissed = false
    try {
      dismissed = localStorage.getItem(KEY) === '1'
    } catch {
      /* storage blocked: still offer */
    }
    if (dismissed || passkeyOnDevice()) return
    setName(biometricName(navigator.userAgent))
    void hasBuiltInUnlock().then(setShow)
  }, [])

  if (!show) return null
  function dismiss() {
    setShow(false)
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* nothing to remember it in */
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-forest/20 bg-sage-soft px-4 py-3 text-forest">
      <ScanFace aria-hidden className="size-6 shrink-0" strokeWidth={1.75} />
      <Link href="/portal/face-id" className="min-w-0 flex-1 py-1">
        <span className="block text-base font-bold">כניסה בלי סיסמה</span>
        <span className="block text-sm">להפעיל {name} במכשיר הזה? לוקח חצי דקה.</span>
      </Link>
      <button type="button" onClick={dismiss} aria-label="לא עכשיו" title="לא עכשיו" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-surface/60">
        <X aria-hidden className="size-5" />
      </button>
    </div>
  )
}
