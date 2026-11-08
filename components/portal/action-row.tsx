import { ChevronLeft, ExternalLink } from 'lucide-react'
import type { ActionView } from '@/lib/portal/model'
import { AudienceTag } from './bits'
import { ShareButtons } from './share'
import { TrackedLink } from './tracked-link'

export type { ActionView }

/**
 * One action: the whole text block opens it (one tap), Copy and Share sit
 * beside it on a computer and under it on a phone. An outside app opens in a
 * new tab and says so, so the portal is still there to come back to.
 */
export function ActionRow({ a }: { a: ActionView }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-base font-bold text-ink">{a.title}</span>
          {a.audience !== 'team' ? <AudienceTag audience={a.audience} /> : null}
        </span>
        {a.description ? <span className="mt-0.5 block text-sm text-muted">{a.description}</span> : null}
        {a.categoryTitle ? <span className="mt-0.5 block text-xs text-faint">{a.categoryTitle}</span> : null}
      </span>
      {a.external ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
          <ExternalLink aria-hidden className="size-4" />
          <span className="sr-only sm:not-sr-only">נפתח בחלון חדש</span>
        </span>
      ) : (
        <ChevronLeft aria-hidden className="hidden size-5 shrink-0 text-muted sm:block" />
      )}
    </>
  )
  const cls = 'flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1 outline-offset-4'
  return (
    <li className="flex items-center gap-2 rounded-lg border border-line bg-surface py-3 pe-3 ps-4 shadow-card sm:gap-3 sm:p-4">
      <TrackedLink id={a.id} href={a.href} external={a.external} className={cls}>
        {body}
      </TrackedLink>
      {/* On a phone the two buttons are icons (still 44px, named for screen readers), so a row stays one row. */}
      <ShareButtons url={a.shareUrl} title={a.title} compact />
    </li>
  )
}
