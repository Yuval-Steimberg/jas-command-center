'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { signIn, type LoginState } from './actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button disabled={pending} className="h-11 w-full rounded-full bg-brand text-sm font-semibold text-forest transition-colors hover:bg-brand-pressed hover:text-cream disabled:opacity-60">
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  )
}

export function LoginForm({ askEmail }: { askEmail: boolean }) {
  const [state, action] = useFormState<LoginState, FormData>(signIn, {})
  return (
    <form action={action} className="flex flex-col gap-3">
      {askEmail ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Email</span>
          <input name="email" type="email" autoComplete="username" required className="h-11 rounded-md border border-line bg-surface px-3" />
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className="h-11 rounded-md border border-line bg-surface px-3" />
      </label>
      {state.error ? (
        <p role="alert" className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      ) : null}
      <Submit />
    </form>
  )
}
