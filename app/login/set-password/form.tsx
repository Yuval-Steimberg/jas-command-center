'use client'

import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { setPassword, type SetPasswordState } from './actions'

function Submit() {
  const { pending } = useFormStatus()
  return <button disabled={pending} className="h-11 w-full rounded-full bg-forest text-sm font-medium text-cream disabled:opacity-60">{pending ? 'Saving…' : 'Set password and sign in'}</button>
}

/** The invite link's tokens live in the URL fragment, which only the browser can read. */
export function SetPasswordForm({ tokenHash }: { tokenHash: string | null }) {
  const [state, action] = useFormState<SetPasswordState, FormData>(setPassword, {})
  const [tokens, setTokens] = useState<{ access: string; refresh: string } | null>(null)
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1))
    const access = h.get('access_token')
    const refresh = h.get('refresh_token')
    if (access && refresh) setTokens({ access, refresh })
    // Keep the tokens out of the address bar and history once read.
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])
  const linkError = !tokenHash && !tokens
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="accessToken" value={tokens?.access ?? ''} />
      <input type="hidden" name="refreshToken" value={tokens?.refresh ?? ''} />
      <input type="hidden" name="tokenHash" value={tokenHash ?? ''} />
      <label className="flex flex-col gap-1 text-sm">New password<input name="password" type="password" autoComplete="new-password" required minLength={10} className="h-11 rounded-md border border-line bg-surface px-3" /></label>
      <label className="flex flex-col gap-1 text-sm">Repeat it<input name="confirm" type="password" autoComplete="new-password" required minLength={10} className="h-11 rounded-md border border-line bg-surface px-3" /></label>
      {state.error ? <p role="alert" className="text-sm text-bad">{state.error}</p> : linkError ? <p className="text-xs text-muted">Open this page from the link in your invitation email.</p> : null}
      <Submit />
    </form>
  )
}
