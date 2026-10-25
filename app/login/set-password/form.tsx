'use client'

import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { describeLinkError, parseAuthFragment } from '@/lib/auth/auth-link'
import { setPassword, type SetPasswordState } from './actions'

function Submit() {
  const { pending } = useFormStatus()
  return <button disabled={pending} className="h-11 w-full rounded-full bg-forest text-sm font-medium text-cream disabled:opacity-60">{pending ? 'Saving…' : 'Set password and sign in'}</button>
}

/** The invite link's tokens live in the URL fragment, which only the browser can read. */
export function SetPasswordForm({ tokenHash, otpType }: { tokenHash: string | null; otpType: string }) {
  const [state, action] = useFormState<SetPasswordState, FormData>(setPassword, {})
  const [tokens, setTokens] = useState<{ access: string; refresh: string } | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  useEffect(() => {
    const f = parseAuthFragment(window.location.hash)
    if (f?.kind === 'tokens') setTokens({ access: f.access, refresh: f.refresh })
    if (f?.kind === 'error') setRefused(describeLinkError(f))
    // Keep the tokens out of the address bar and history once read.
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])
  const linkError = !tokenHash && !tokens
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="accessToken" value={tokens?.access ?? ''} />
      <input type="hidden" name="refreshToken" value={tokens?.refresh ?? ''} />
      <input type="hidden" name="tokenHash" value={tokenHash ?? ''} />
      <input type="hidden" name="otpType" value={otpType} />
      <label className="flex flex-col gap-1 text-sm">New password<input name="password" type="password" autoComplete="new-password" required minLength={10} className="h-11 rounded-md border border-line bg-surface px-3" /></label>
      <label className="flex flex-col gap-1 text-sm">Repeat it<input name="confirm" type="password" autoComplete="new-password" required minLength={10} className="h-11 rounded-md border border-line bg-surface px-3" /></label>
      {state.error ? <p role="alert" className="text-sm text-bad">{state.error}</p> : refused ? <p role="alert" className="text-sm text-bad">{refused}</p> : linkError ? <p className="text-xs text-muted">Open this page from the link in your invitation email.</p> : null}
      <Submit />
    </form>
  )
}
