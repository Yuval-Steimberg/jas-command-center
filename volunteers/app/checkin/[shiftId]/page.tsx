import type { Metadata } from 'next'
import { requireVolunteer } from '@/lib/session'
import { getStore } from '@/lib/store'
import { load } from '@/lib/load'
import { placeHe, whenHe } from '@/lib/format'
import { ActionForm } from '@/components/forms'
import { Card, Notice, Page, Title, primaryBtn } from '@/components/ui'
import { checkinAction } from '../../actions'

export const metadata: Metadata = { title: 'רישום הגעה' }

/**
 * Where the QR code at the activity leads. The code in the link proves the
 * person is at the shift; signing in proves who they are. Nothing is recorded
 * until they press the button, so opening the link by accident does nothing.
 */
export default async function Checkin({ params, searchParams }: { params: { shiftId: string }; searchParams: { c?: string } }) {
  const code = typeof searchParams.c === 'string' ? searchParams.c : ''
  const next = `/checkin/${encodeURIComponent(params.shiftId)}?c=${encodeURIComponent(code)}`
  const v = await requireVolunteer(next)
  const res = await load(async () => {
    const store = getStore()
    const shift = await store.getShift(params.shiftId)
    const activity = shift ? await store.getActivity(shift.activityId) : null
    const mine = shift ? (await store.listSignups({ shiftIds: [shift.id], volunteerId: v.id }))[0] ?? null : null
    return { shift, activity, mine }
  })
  if (!res.ok) return <Page><Title>רישום הגעה</Title><Notice tone="bad">{res.message}</Notice></Page>
  const { shift, activity, mine } = res.data
  if (!shift || !activity || !code) return <Page><Title>רישום הגעה</Title><Notice tone="bad">הקישור לא שלם. נא לסרוק שוב את הקוד שתלוי במקום הפעילות.</Notice></Page>
  const checkedIn = mine?.status === 'confirmed' && mine.checkInAt && !mine.checkOutAt
  return (
    <Page>
      <Title sub="סריקה ראשונה רושמת הגעה, סריקה נוספת בסוף רושמת יציאה.">רישום הגעה</Title>
      <Card>
        <p className="text-lg font-bold text-forest">{activity.title}</p>
        <p className="mt-1 text-base text-slate">{whenHe(shift)}</p>
        <p className="text-base text-slate">{placeHe(activity)}</p>
      </Card>
      {!mine || mine.status !== 'confirmed' ? <p className="mt-4 text-base text-slate">לא מצאנו הרשמה שלך למשמרת הזו. אם יש מקום, הרישום יצרף אותך כמגיע/ה ללא הרשמה מראש.</p> : null}
      <ActionForm action={checkinAction} hidden={{ shiftId: shift.id, code }} submit={checkedIn ? 'רישום יציאה' : 'הגעתי'} busy="רושמים…" btnClass={`${primaryBtn} mt-6`} />
    </Page>
  )
}
