import type { MemoryVolData } from '@shared/volunteers/store'
import type { Activity, Shift } from '@shared/volunteers/model'
import { addDays, israelDay, israelToUtc } from '@shared/volunteers/time'

/**
 * Local development only (no database configured): two published activities
 * so the screens have something to show. Never used in production; getStore()
 * refuses to fall back to memory there.
 */
export function seedDemo(d: MemoryVolData): MemoryVolData {
  const t = new Date().toISOString()
  const today = israelDay()
  const base = { summary: null, description: null, status: 'published' as const, furnitureProjectId: null, furnitureProjectName: null, mapUrl: null, arrivalInfo: null, requirements: null, equipment: null, instructions: null, adultsOnly: false, requiredSkills: [], coordinatorProfileId: null, coordinatorName: 'נועה', contactPhone: '058-787-6549', photoUrls: [], signupClosesHours: 0, seriesId: null, cancelReason: null, cancelledAt: null, version: 1, createdBy: 'demo', createdAt: t, updatedAt: t }
  const a1: Activity = { ...base, id: 'demo-collection', title: 'איסוף רהיטים לפני פינוי, רחוב ביאליק', summary: 'מוציאים רהיטים טובים מדירות לפני ההריסה, כדי שיקבלו חיים שניים.', kind: 'collection', locationName: 'בניין 12', address: 'ביאליק 12, רמת גן', area: 'ramat_gan_givatayim', equipment: 'כפפות עבודה, נעליים סגורות ובקבוק מים', requirements: 'הרמה של רהיטים בינוניים, עבודה במדרגות', instructions: 'נפגשים בכניסה לבניין. הרכז/ת מחלק/ת לצוותים לפי קומות.', arrivalInfo: 'חניה ברחוב הסמוך. 5 דקות הליכה מתחנת הרכבת הקלה.', adultsOnly: true, requiredSkills: [] }
  const a2: Activity = { ...base, id: 'demo-sorting', title: 'מיון וסידור במחסן', summary: 'ממיינים חפצים שנאספו ומכינים אותם לחנות.', kind: 'sorting', locationName: 'החנות של Just A Second', address: 'מנחם בגין 34, תל אביב', area: 'tel_aviv', equipment: 'בגדים נוחים', instructions: 'נכנסים דרך החנות ושואלים על הרכז/ת.' }
  const sh = (id: string, a: string, day: string, from: string, to: string, capacity: number, label: string): Shift => ({ id, activityId: a, label, role: null, startsAt: israelToUtc(day, from)!, endsAt: israelToUtc(day, to)!, capacity, minVolunteers: 2, status: 'open', checkinCode: `code-${id}`, version: 1, createdAt: t, updatedAt: t })
  // One shift under way now, so the QR check-in can be tried locally.
  const now = Date.now()
  const nowShift: Shift = { ...sh('demo-s0', a2.id, today, '00:00', '01:00', 8, 'עכשיו'), startsAt: new Date(now - 30 * 60_000).toISOString(), endsAt: new Date(now + 150 * 60_000).toISOString() }
  d.activities.push(a1, a2)
  d.shifts.push(nowShift)
  d.shifts.push(
    sh('demo-s1', a1.id, addDays(today, 2), '08:00', '12:00', 6, 'בוקר'),
    sh('demo-s2', a1.id, addDays(today, 2), '12:00', '16:00', 5, 'צהריים'),
    sh('demo-s3', a1.id, addDays(today, 2), '16:00', '19:00', 3, 'ערב'),
    sh('demo-s4', a2.id, addDays(today, 4), '10:00', '13:00', 4, 'בוקר'),
  )
  return d
}
