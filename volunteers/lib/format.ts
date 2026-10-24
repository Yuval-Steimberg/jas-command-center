import type { Activity } from '@shared/volunteers/model'
import { AREA_HE } from '@shared/volunteers/model'
import type { ShiftView } from '@shared/volunteers/views'
import { dayLabelHe, israelDay, timeRange } from '@shared/volunteers/time'

export const whenHe = (s: { startsAt: string; endsAt: string }) => `${dayLabelHe(s.startsAt)} · ${timeRange(s.startsAt, s.endsAt)}`

export function relativeDayHe(iso: string, now = Date.now()): string | null {
  const d = israelDay(iso)
  const today = israelDay(now)
  const tomorrow = israelDay(now + 86_400_000)
  return d === today ? 'היום' : d === tomorrow ? 'מחר' : null
}

export function placesHe(v: Pick<ShiftView, 'phase' | 'places' | 'counts'>): { text: string; tone: 'ok' | 'warn' | 'neutral' | 'bad' } {
  switch (v.phase) {
    case 'cancelled':
      return { text: 'בוטל', tone: 'bad' }
    case 'finished':
      return { text: 'הסתיים', tone: 'neutral' }
    case 'underway':
      return { text: 'מתקיים עכשיו', tone: 'neutral' }
    case 'closed':
      return { text: 'ההרשמה נסגרה', tone: 'neutral' }
    case 'full':
      return { text: v.counts.waitlisted ? `מלא · ${v.counts.waitlisted} ברשימת המתנה` : 'מלא · אפשר להמתין', tone: 'warn' }
    case 'open':
      return { text: v.places === 1 ? 'מקום אחרון' : `${v.places} מקומות פנויים`, tone: v.places <= 2 ? 'warn' : 'ok' }
  }
}

export const placeHe = (a: Pick<Activity, 'locationName' | 'address' | 'area'>) => [a.locationName, a.address].filter(Boolean).join(', ') || (a.area ? AREA_HE[a.area] : 'המיקום יעודכן')

/** Navigation links built from the address text: no coordinates are stored or guessed. */
export function directions(a: Pick<Activity, 'address' | 'mapUrl' | 'locationName'>) {
  const q = a.address ?? a.locationName
  return {
    waze: q ? `https://waze.com/ul?q=${encodeURIComponent(q)}&navigate=yes` : null,
    google: a.mapUrl ?? (q ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}` : null),
  }
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`
