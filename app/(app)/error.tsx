'use client'

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-lg border border-bad/30 bg-surface p-5">
      <h1 className="font-semibold">This page could not load</h1>
      <p className="mt-1 text-sm text-muted">Something failed while loading this page. Other pages are unaffected.</p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-faint">ref {error.digest}</p> : null}
      <button onClick={reset} className="mt-4 rounded-full border border-line px-3 py-1.5 text-sm hover:bg-sunken">Try again</button>
    </div>
  )
}
