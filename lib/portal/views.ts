import 'server-only'
import type { PermissionOverrides, Role } from '@/lib/auth/rbac'
import { normalize } from '@/lib/search/match'
import { portalFor, toView, type ShownCategory } from './model'
import { appUrls, loadPortal } from './service'

export { toView }

/** Everything one person sees on the portal, plus the search index over it. */
export async function portalView(role: Role, overrides: PermissionOverrides | undefined) {
  const { data, problem } = await loadPortal()
  const categories: ShownCategory[] = portalFor(data, { role, overrides }, appUrls())
  const search = categories.flatMap((c) =>
    c.actions.map((a) => ({ ...toView(a, c.title), text: normalize([a.title, a.description, c.title, c.subtitle].join(' ')) })),
  )
  return { categories, search, problem }
}
