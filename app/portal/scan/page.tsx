import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { PortalScanner } from '@/components/portal/scanner'

export const dynamic = 'force-dynamic'

/** One scan for the shop: an item label opens the item, a gift card opens it in the gift card system. */
export default async function ScanPage() {
  if (!(await getSession())) redirect('/login?next=%2Fportal%2Fscan')
  return (
    <div className="mx-auto max-w-xl">
      <Link href="/portal" className="-ms-2 mb-3 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-sm text-muted hover:bg-sunken hover:text-ink">
        <ArrowRight aria-hidden className="size-4" />
        חזרה לפורטל
      </Link>
      <h1 className="text-2xl font-extrabold text-ink">סריקה</h1>
      <p className="mb-5 mt-1 text-base text-muted">מדבקה של פריט או שובר מתנה. מכוונים את המצלמה, והמסך הנכון נפתח לבד.</p>
      <PortalScanner />
    </div>
  )
}
