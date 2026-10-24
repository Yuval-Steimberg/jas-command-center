import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentVolunteer, safeNext } from '@/lib/session'
import { Page, Title } from '@/components/ui'
import { LoginForm } from './form'

export const metadata: Metadata = { title: 'כניסה' }

export default async function Login({ searchParams }: { searchParams: { next?: string } }) {
  const next = safeNext(searchParams.next)
  if (await currentVolunteer().catch(() => null)) redirect(next)
  return (
    <Page className="pt-8">
      <Title sub="מתנדבים חדשים וותיקים נכנסים באותה דרך: כתובת אימייל וקוד. אם זו הפעם הראשונה, נבקש עוד כמה פרטים קצרים.">כניסה והצטרפות</Title>
      <LoginForm next={next} />
      <p className="mt-8 text-center text-sm text-slate">ממשיכים? זה אומר שקראת את <Link href="/privacy" className="underline underline-offset-4">מה אנחנו שומרים ולמה</Link>.</p>
    </Page>
  )
}
