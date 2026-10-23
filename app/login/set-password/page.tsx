import { SetPasswordForm } from './form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Set your password · JAS Command Center' }

export default function SetPasswordPage({ searchParams }: { searchParams?: { token_hash?: string } }) {
  const tokenHash = typeof searchParams?.token_hash === 'string' ? searchParams.token_hash.slice(0, 400) : null
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-5 shadow-card">
        <h1 className="mb-1 text-lg font-semibold">Set your password</h1>
        <p className="mb-4 text-sm text-muted">You were invited to the JAS Command Center.</p>
        <SetPasswordForm tokenHash={tokenHash} />
      </div>
    </main>
  )
}
