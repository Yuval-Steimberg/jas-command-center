import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { authMode } from '@/lib/auth/mode'
import { supabaseUserClient } from '@/lib/supabase'
import { passkeysEnabled } from '@/lib/auth/passkeys'
import { PasskeyManager, type SavedPasskey } from '@/components/auth/passkey-manager'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'JAS · כניסה עם Face ID' }

/**
 * Everyone's own page: turn Face ID on for this phone or computer, and see or
 * remove the devices that can already sign in. Plain Hebrew; one big button.
 */
export default async function FaceIdPage() {
  const s = await getSession()
  if (!s) redirect('/login?next=/portal/face-id')

  const mode = authMode()
  const enabled = mode.kind === 'supabase' ? await passkeysEnabled() : false
  let saved: SavedPasskey[] | null = null
  if (mode.kind === 'supabase' && enabled !== false) {
    const { data, error } = await supabaseUserClient().auth.passkey.list()
    saved = error || !data ? null : data.map((p) => ({ id: p.id, name: p.friendly_name ?? null, createdAt: p.created_at, lastUsedAt: p.last_used_at ?? null }))
  }

  return (
    <div className="mx-auto max-w-xl">
      <Link href="/portal" className="mb-3 inline-flex h-11 items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronRight aria-hidden className="h-4 w-4" />
        חזרה לפורטל
      </Link>
      <h1 className="text-2xl font-extrabold text-ink">כניסה עם Face ID</h1>
      <p className="mt-2 text-base text-muted">
        במקום להקליד סיסמה בכל פעם: מסתכלים בטלפון (או נוגעים בחיישן טביעת האצבע) ונכנסים. מפעילים פעם אחת בכל מכשיר.
      </p>

      {mode.kind !== 'supabase' ? (
        <p className="mt-5 rounded-lg border border-line bg-surface p-4 text-base text-muted">בסביבת הפיתוח המקומית אין כניסה מהירה. היא פועלת באתר עצמו.</p>
      ) : enabled === false ? (
        <p role="status" className="mt-5 rounded-lg border border-warn/30 bg-warn/5 p-4 text-base text-warn">
          כניסה מהירה עוד לא הופעלה במערכת. ברגע שהיא תופעל, הכפתור יופיע כאן.
        </p>
      ) : (
        <PasskeyManager saved={saved} />
      )}
    </div>
  )
}
