import { redirect } from 'next/navigation'
import { authMode } from '@/lib/auth/mode'
import { sessionState } from '@/lib/auth/session'
import { signOut } from './actions'
import { LoginForm } from './form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign in · JAS Command Center' }

export default async function LoginPage() {
  const { session, setupError } = await sessionState()
  if (session) redirect('/')
  const mode = authMode()
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span aria-hidden className="grid h-10 w-10 place-items-center rounded-md bg-forest text-sm font-black text-cream">JAS</span>
          <div>
            <h1 className="text-lg font-semibold">Command Center</h1>
            <p className="text-sm text-muted">Just A Second · internal</p>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-5 shadow-card">
          {setupError ? (
            <div role="alert" className="mb-4 rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">
              <p className="font-medium">Setup problem</p>
              <p className="mt-1">{setupError}</p>
              <form action={signOut} className="mt-2">
                <button className="text-xs underline underline-offset-2">Clear my sign-in and try again</button>
              </form>
            </div>
          ) : null}
          {mode.kind === 'unconfigured' ? (
            <p role="alert" className="text-sm text-muted">{mode.reason}</p>
          ) : (
            <>
              {mode.kind === 'dev' ? <p className="mb-3 rounded-md bg-sunken px-3 py-2 text-xs text-muted">Local development login (owner). Disabled in production builds.</p> : null}
              <LoginForm askEmail={mode.kind === 'supabase'} />
            </>
          )}
        </div>
      </div>
    </main>
  )
}
