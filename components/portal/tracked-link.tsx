'use client'

import Link from 'next/link'

/** Counts a tap toward the person's most used buttons, without delaying the link. */
export function track(id: string) {
  try {
    navigator.sendBeacon?.('/api/portal/use', new Blob([id], { type: 'text/plain' }))
  } catch {
    // A lost count is harmless; the link opens regardless.
  }
}

/** A portal action link: internal pages through Next's Link, other apps in a new tab. */
export function TrackedLink({ id, href, external, className, children }: { id: string; href: string; external: boolean; className?: string; children: React.ReactNode }) {
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} onClick={() => track(id)}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className} onClick={() => track(id)}>
      {children}
    </Link>
  )
}
