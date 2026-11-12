'use client'

import { useEffect, useState } from 'react'
import { ScanFace } from 'lucide-react'
import { biometricName, browserSupportsPasskeys, credentialJson, passkeyMessage, passkeyOnDevice, rememberPasskeyOnDevice, requestOptions, runCeremony } from '@/lib/auth/passkey-browser'
import { finishPasskeySignIn, startPasskeySignIn } from '@/app/login/passkey-actions'
import { usePrefetchedChallenge } from './use-challenge'

/**
 * "Sign in with Face ID" on the login page, rendered in two places; each shows
 * itself only in its own case. `top`: this device turned Face ID on before, so
 * it leads. `below`: it did not (or forgot), so the password form leads and a
 * quiet link plus one line says how to turn it on. Tapping Face ID on a phone
 * with nothing saved opens the phone's own "no passkeys" sheet, which reads as
 * broken to staff.
 */
export function PasskeySignIn({ next, place }: { next?: string | null; place: 'top' | 'below' }) {
  const [show, setShow] = useState(false)
  const [name, setName] = useState('Face ID')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const take = usePrefetchedChallenge(startPasskeySignIn, show)

  useEffect(() => {
    if (!browserSupportsPasskeys()) return
    setName(biometricName(navigator.userAgent))
    setShow(passkeyOnDevice() === (place === 'top'))
  }, [place])

  if (!show) return null

  async function go() {
    setBusy(true)
    setError(null)
    try {
      const start = await take()
      if (!start.ok) return setError(passkeyMessage(start.code).message)
      const got = await runCeremony(() => navigator.credentials.get({ publicKey: requestOptions(start.options) }))
      if (!got.ok) {
        const m = passkeyMessage(got.code)
        // Closing the Face ID sheet is a choice, not a failure.
        return m.cancelled ? undefined : setError(m.message)
      }
      const done = await finishPasskeySignIn(start.challengeId, credentialJson(got.value as never), next ?? '')
      if (!done.ok) {
        if (done.code === 'webauthn_credential_not_found') rememberPasskeyOnDevice(false)
        return setError(done.message ?? passkeyMessage(done.code).message)
      }
      rememberPasskeyOnDevice(true)
      // A full load, so every server component reads the new session cookie.
      window.location.assign(done.to)
    } catch {
      setError(passkeyMessage(undefined).message)
    } finally {
      setBusy(false)
    }
  }

  const alert = error ? (
    <p role="alert" className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">
      {error}
    </p>
  ) : null

  if (place === 'below') {
    return (
      <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-center text-sm" dir="rtl">
        <p className="text-muted">
          רוצים להיכנס בלי סיסמה? נכנסים פעם אחת עם הסיסמה, ובפורטל מפעילים {name}.
        </p>
        <button type="button" onClick={go} disabled={busy} className="mx-auto inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-forest underline-offset-4 hover:underline disabled:opacity-60">
          <ScanFace aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          {busy ? 'רגע…' : `כבר הפעלתי? כניסה עם ${name}`}
        </button>
        {alert}
      </div>
    )
  }

  return (
    <div className="mb-4 flex flex-col gap-3" dir="rtl">
      <button type="button" onClick={go} disabled={busy} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-forest text-base font-semibold text-cream transition-colors hover:bg-forest/90 disabled:opacity-60">
        <ScanFace aria-hidden className="h-5 w-5" strokeWidth={1.75} />
        {busy ? 'רגע…' : `כניסה עם ${name}`}
      </button>
      {alert}
      <div className="flex items-center gap-3 text-xs text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        או עם סיסמה · or with your password
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  )
}
