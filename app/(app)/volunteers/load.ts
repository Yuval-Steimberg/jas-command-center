import 'server-only'

/** Shared with /analytics and the assistant: one definition of what a window of volunteer data is. */
export { loadVolunteerWindow as loadWindow } from '@/lib/volunteer-store'

/** Real furniture projects for the link select. When the field app cannot be read, say so instead of an empty list. */
export async function projectOptions(): Promise<{ projects: { id: string; name: string }[]; note: string | null }> {
  const { getFurnitureProjects } = await import('@/lib/integrations/furniture/adapter')
  const r = await getFurnitureProjects()
  if (r.state === 'ok') return { projects: r.data.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)), note: null }
  return { projects: [], note: r.state === 'not_configured' ? 'The furniture app is not connected, so projects cannot be listed.' : 'The furniture app could not be read just now; projects cannot be listed.' }
}
