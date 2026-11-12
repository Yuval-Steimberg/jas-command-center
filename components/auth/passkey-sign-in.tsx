'use client'

import { useEffect, useState } from 'react'
import { ScanFace } from 'lucide-react'
import { biometricName, browserSupportsPasskeys, credentialJson, passkeyMessage, requestOptions, runCeremony } from '@/lib/auth/passkey-browser'
import { finishPasskeySignIn, startPasskeySignIn } from '@/app/login/passkey-actions'
import { usePrefetchedChallenge } from './use-challenge'

/**
 * "Sign in with Face ID" on the login page. Only rendered when the browser can
 * do passkeys at all; whether THIS device has one saved is the device's own
 * secret, so the button is offered and a device with none says so.
 */
export function PasskeySignIn({ next }: { next?: string | null }) {
  const [ready, setReady] = useState(false)
  const [name, setName] = useState('Face ID')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const take = usePrefetchedChallenge(startPasskeySignIn, ready)

  useEffect(() => {
    setReady(browserSupportsPasskeys())
    setName(biometricName(navigator.userAgent))
  }, [])

  if (!ready) return null

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
      if (!done.ok) return setError(done.message ?? passkeyMessage(done.code).message)
      // A full load, so every server component reads the new session cookie.
      window.location.assign(done.to)
    } catch {
      setError(passkeyMessage(undefined).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 flex flex-col gap-3" dir="rtl">
      <button type="button" onClick={go} disabled={busy} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-forest text-base font-semibold text-cream transition-colors hover:bg-forest/90 disabled:opacity-60">
        <ScanFace aria-hidden className="h-5 w-5" strokeWidth={1.75} />
        {busy ? 'רגע…' : `כניסה עם ${name}`}
      </button>
      {error ? (
        <p role="alert" className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-3 text-xs text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        או עם סיסמה · or with your password
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  )
}
