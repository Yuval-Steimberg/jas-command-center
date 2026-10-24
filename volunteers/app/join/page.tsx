import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentVolunteer, pendingEmail, safeNext } from '@/lib/session'
import { Page, Title } from '@/components/ui'
import { JoinForm } from './form'

export const metadata: Metadata = { title: 'הצטרפות' }

export default async function Join({ searchParams }: { searchParams: { next?: string } }) {
  const next = safeNext(searchParams.next)
  if (await currentVolunteer().catch(() => null)) redirect(next)
  const email = pendingEmail()
  if (!email) redirect(`/login?next=${encodeURIComponent(next)}`)
  return (
    <Page>
      <Title sub={<>האימייל <span className="ltr font-semibold text-forest">{email}</span> אומת. נשארו שלושה פרטים, וכל השאר לא חובה.</>}>נעים להכיר</Title>
      <JoinForm next={next} />
    </Page>
  )
}
