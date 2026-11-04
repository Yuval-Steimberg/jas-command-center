import { currentScheduler } from '@/lib/schedule/store'
import { israelDate } from '@/lib/time'
import { scheduleErrorHe } from '@/lib/volunteers/schedule-messages'
import { hhmm, plusDays, shortDate, WEEKDAY_HE } from '@/lib/volunteers/schedule'
import { endRegularAction, setReservistAction } from '@/app/schedule/actions'
import { ActButton } from '@/components/schedule/act-button'
import { Phone, Reservist, empty, rowCls } from '@/components/schedule/bits'
import { AddRegularForm, HoursForm, NewVolunteerForm, RequiredForm } from '@/components/schedule/forms'

export const dynamic = 'force-dynamic'

/**
 * The recurring week: for each operating day, how many volunteers it needs and
 * who comes every week. Changes here repeat every week from the chosen date;
 * a single date is changed on that day's screen instead.
 */
export default async function TeamPage() {
  const s = await currentScheduler()
  if ('error' in s) return null
  const today = israelDate()
  let data
  try {
    data = await s.store.load(s.location.id, today, plusDays(today, 120))
  } catch (e) {
    return <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{scheduleErrorHe(e)}</p>
  }
  const vol = new Map(data.volunteers.map((v) => [v.id, v]))
  const active = data.volunteers.filter((v) => v.status === 'active').sort((a, b) => a.fullName.localeCompare(b.fullName, 'he'))
  const yesterday = plusDays(today, -1)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">קבועים</h1>
        <p className="text-sm text-muted">מי מגיע כל שבוע, וכמה צריך בכל יום.{s.canEdit ? ' שינוי כאן חוזר כל שבוע; שינוי של תאריך אחד עושים במסך של אותו יום.' : ''}</p>
      </div>
      {s.canEdit ? <NewVolunteerForm today={today} slots={data.slots.filter((x) => x.active).map((x) => ({ id: x.id, label: WEEKDAY_HE[x.weekday] ?? '' }))} /> : null}
      {data.slots.filter((x) => x.active).map((slot) => {
        const regs = data.regulars.filter((r) => r.slotId === slot.id && (r.endsOn === null || r.endsOn >= today)).sort((a, b) => (vol.get(a.volunteerId)?.fullName ?? '').localeCompare(vol.get(b.volunteerId)?.fullName ?? '', 'he'))
        const taken = new Set(regs.map((r) => r.volunteerId))
        return (
          <section key={slot.id} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-card">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-bold text-ink">ימי {WEEKDAY_HE[slot.weekday]}</h2>
              <span className="num text-sm text-muted">{regs.length} קבועים{slot.required !== null ? ` · נדרשים ${slot.required}` : ''}</span>
            </div>
            {s.canEdit ? (
              <>
                <RequiredForm slotId={slot.id} version={slot.version} required={slot.required} />
                <HoursForm slotId={slot.id} version={slot.version} startsAt={slot.startsAt} endsAt={slot.endsAt} />
              </>
            ) : <p className="text-sm text-muted">נדרשים: {slot.required ?? 'לא נקבע'}{slot.startsAt && slot.endsAt ? <> · <span className="num" dir="ltr">{hhmm(slot.startsAt)}–{hhmm(slot.endsAt)}</span></> : null}</p>}
            {regs.length ? (
              <ul className="flex flex-col gap-2">
                {regs.map((r) => {
                  const v = vol.get(r.volunteerId)
                  return (
                    <li key={r.id} className={rowCls}>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-ink">{v?.fullName ?? 'מתנדב/ת'}<Reservist on={v?.reservist} /></p>
                        <p className="text-xs text-muted">
                          {r.startsOn > today ? `מתחיל/ה ב-${shortDate(r.startsOn)}` : 'כל שבוע'}
                          {r.endsOn ? ` · עד ${shortDate(r.endsOn)}` : ''}
                          {v && v.status !== 'active' ? ' · חשבון לא פעיל' : ''}
                        </p>
                      </div>
                      <Phone phone={v?.phone ?? null} />
                      {s.canEdit && v ? <ActButton action={setReservistAction} args={{ volunteerId: v.id, on: !v.reservist }} label={v.reservist ? 'לא במילואים' : 'מילואים'} small /> : null}
                      {s.canEdit ? <ActButton action={endRegularAction} args={{ regularId: r.id, last: yesterday }} label="הסרה מהקבועים" small tone="danger" confirm={`להסיר את ${v?.fullName ?? 'המתנדב/ת'} מהקבועים של ימי ${WEEKDAY_HE[slot.weekday]}, החל מהיום? שבועות שעברו נשמרים.`} /> : null}
                    </li>
                  )
                })}
              </ul>
            ) : empty(`עוד אין קבועים בימי ${WEEKDAY_HE[slot.weekday]}.`)}
            {s.canEdit ? <AddRegularForm slotId={slot.id} today={today} options={active.filter((v) => !taken.has(v.id)).map((v) => ({ id: v.id, name: v.fullName }))} /> : null}
          </section>
        )
      })}
    </div>
  )
}
