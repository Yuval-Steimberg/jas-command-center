import { redirect } from 'next/navigation'
import { authMode } from '@/lib/auth/mode'
import { getSession } from '@/lib/auth/session'
import { LoginForm } from './form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign in · JAS Command Center' }

export default async function LoginPage() {
  if (await getSession()) redirect('/')
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
