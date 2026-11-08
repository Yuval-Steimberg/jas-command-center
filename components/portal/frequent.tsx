import { getUsageStore } from '@/lib/portal/usage'
import { frequent } from '@/lib/portal/today'
import type { ActionView } from '@/lib/portal/model'
import { TrackedLink } from './tracked-link'

/** The person's own most used buttons, first on the home page. Nothing until a button was used twice. */
export async function Frequent({ userId, shown }: { userId: string; shown: ActionView[] }) {
  let top: ActionView[] = []
  try {
    top = frequent(await getUsageStore().forProfile(userId), shown)
  } catch {
    // Before migration 0018, or a read error: the shortcuts are a convenience, so the home page simply goes without.
    return null
  }
  if (!top.length) return null
  return (
    <section aria-labelledby="frequent-h">
      <h2 id="frequent-h" className="mb-2 text-sm font-bold text-ink">השימושים שלך</h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {top.map((a) => (
          <li key={a.id}>
            <TrackedLink id={a.id} href={a.href} external={a.external} className="flex min-h-14 items-center rounded-lg border border-line bg-surface px-4 py-2 text-base font-bold text-ink shadow-card hover:bg-sunken">
              {a.title}
            </TrackedLink>
          </li>
        ))}
      </ul>
    </section>
  )
}
