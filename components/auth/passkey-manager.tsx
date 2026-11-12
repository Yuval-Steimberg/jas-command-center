'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ScanFace, Smartphone, Trash2 } from 'lucide-react'
import { biometricName, browserSupportsPasskeys, creationOptions, credentialJson, deviceLabel, passkeyMessage, runCeremony } from '@/lib/auth/passkey-browser'
import { finishPasskeySetup, removePasskey, startPasskeySetup } from '@/app/portal/face-id/actions'
import { usePrefetchedChallenge } from './use-challenge'

export type SavedPasskey = { id: string; name: string | null; createdAt: string; lastUsedAt: string | null }

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Jerusalem' })

/** Turn Face ID on for this device, and the list of devices that can sign in. */
export function PasskeyManager({ saved }: { saved: SavedPasskey[] | null }) {
  const router = useRouter()
  const [supported, setSupported] = useState<boolean | null>(null)
  const [name, setName] = useState('Face ID')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const take = usePrefetchedChallenge(startPasskeySetup, supported === true)

  useEffect(() => {
    setSupported(browserSupportsPasskeys())
    setName(biometricName(navigator.userAgent))
  }, [])

  async function turnOn() {
    setBusy(true)
    setMsg(null)
    try {
      const s = await take()
      if (!s.ok) return setMsg({ ok: false, text: passkeyMessage(s.code).message })
      const got = await runCeremony(() => navigator.credentials.create({ publicKey: creationOptions(s.options) }))
      if (!got.ok) {
        const m = passkeyMessage(got.code)
        return m.cancelled ? undefined : setMsg({ ok: false, text: m.message })
      }
      const done = await finishPasskeySetup(s.challengeId, credentialJson(got.value as never), deviceLabel(navigator.userAgent))
      if (!done.ok) return setMsg({ ok: false, text: passkeyMessage(done.code).message })
      setMsg({ ok: true, text: `מעולה. מעכשיו נכנסים מהמכשיר הזה עם ${name}.` })
      router.refresh()
    } catch {
      setMsg({ ok: false, text: passkeyMessage(undefined).message })
    } finally {
      setBusy(false)
    }
  }

  function remove(id: string) {
    start(async () => {
      const r = await removePasskey(id)
      setConfirming(null)
      setMsg(r.ok ? { ok: true, text: 'המכשיר הוסר. ממנו נכנסים שוב עם סיסמה.' } : { ok: false, text: 'ההסרה לא הצליחה. אפשר לנסות שוב.' })
      router.refresh()
    })
  }

  return (
    <div className="mt-5 flex flex-col gap-5">
      {supported === false ? (
        <p className="rounded-lg border border-line bg-surface p-4 text-base text-muted">{passkeyMessage('unsupported').message}</p>
      ) : (
        <button type="button" onClick={turnOn} disabled={busy || supported === null} className="inline-flex min-h-16 w-full items-center justify-center gap-2.5 rounded-lg bg-brand px-4 text-lg font-bold text-forest shadow-card hover:bg-brand-pressed hover:text-cream disabled:opacity-60">
          <ScanFace aria-hidden className="size-6" strokeWidth={1.75} />
          {busy ? 'רגע…' : `הפעלת ${name} במכשיר הזה`}
        </button>
      )}

      <div aria-live="polite" className="empty:hidden">
        {msg ? (
          <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/5 p-4 text-base text-ok' : 'rounded-lg border border-bad/30 bg-bad/5 p-4 text-base text-bad'}>
            {msg.ok ? <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0" /> : null}
            {msg.text}
          </p>
        ) : null}
      </div>

      <section>
        <h2 className="text-lg font-bold text-ink">מכשירים שנכנסים עם Face ID</h2>
        {saved === null ? (
          <p className="mt-2 text-base text-muted">הרשימה לא נטענה כרגע.</p>
        ) : saved.length === 0 ? (
          <p className="mt-2 text-base text-muted">עוד אין. אחרי ההפעלה המכשיר יופיע כאן.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {saved.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3">
                <Smartphone aria-hidden className="size-5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{p.name ?? 'מכשיר'}</span>
                  <span className="block text-sm text-muted">
                    נוסף ב-<span dir="ltr">{day(p.createdAt)}</span>
                    {p.lastUsedAt ? (
                      <>
                        {' · '}כניסה אחרונה <span dir="ltr">{day(p.lastUsedAt)}</span>
                      </>
                    ) : null}
                  </span>
                </span>
                {confirming === p.id ? (
                  <span className="flex gap-2">
                    <button type="button" onClick={() => remove(p.id)} disabled={pending} className="inline-flex h-11 items-center rounded-full bg-bad px-4 text-sm font-semibold text-cream disabled:opacity-60">
                      {pending ? 'מסירים…' : 'כן, להסיר'}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className="inline-flex h-11 items-center rounded-full px-4 text-sm text-muted hover:bg-sunken">
                      ביטול
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirming(p.id)} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm text-muted hover:bg-sunken hover:text-ink">
                    <Trash2 aria-hidden className="size-4" />
                    הסרה
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-muted">טלפון שאבד או הוחלף? מסירים אותו מכאן, וממנו כבר אי אפשר להיכנס בלי סיסמה.</p>
      </section>
    </div>
  )
}
