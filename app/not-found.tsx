import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <h1 className="text-lg font-semibold">Not found</h1>
        <Link href="/" className="mt-2 inline-block text-sm text-muted underline-offset-2 hover:underline">Back to the overview</Link>
      </div>
    </main>
  )
}
