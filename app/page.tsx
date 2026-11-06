import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

/**
 * Home. Everyone starts on the team portal (/portal), the owner's decision of
 * 2026-11-06: a non-technical person should land on "what do you want to do",
 * not on a console. The detailed English console lives at /console, one tap
 * away for those who use it. A shop seller and a volunteer scheduler keep the
 * mode built for their one job.
 */
export default async function Home() {
  const user = await requireUser()
  if (user.role === 'seller') redirect('/shop')
  if (user.role === 'scheduler') redirect('/schedule')
  redirect('/portal')
}
