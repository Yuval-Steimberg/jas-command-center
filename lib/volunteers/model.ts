/**
 * JAS Volunteers — the shared model (migration 0005). Pure: types, the fixed
 * vocabularies and their labels, input validation. Imported by the Command
 * Center AND by the standalone volunteer app (volunteers/), so everything in
 * lib/volunteers imports only relative paths and npm packages, never `@/`.
 *
 * Hebrew labels are the volunteer app's; English ones are the Command Center's.
 */
import { normalizeEmail, normalizePhone } from '../crm/model'

export { normalizeEmail, normalizePhone }

// ── Vocabularies ───────────────────────────────────────────────────────────

export const AREAS = ['tel_aviv', 'ramat_gan_givatayim', 'holon_bat_yam', 'bnei_brak', 'herzliya_sharon', 'petah_tikva', 'rishon_rehovot', 'other'] as const
export type Area = (typeof AREAS)[number]
export const AREA_HE: Record<Area, string> = {
  tel_aviv: 'תל אביב-יפו',
  ramat_gan_givatayim: 'רמת גן וגבעתיים',
  holon_bat_yam: 'חולון ובת ים',
  bnei_brak: 'בני ברק',
  herzliya_sharon: 'הרצליה והשרון',
  petah_tikva: 'פתח תקווה',
  rishon_rehovot: 'ראשון לציון ורחובות',
  other: 'אזור אחר',
}
export const AREA_EN: Record<Area, string> = {
  tel_aviv: 'Tel Aviv-Yafo',
  ramat_gan_givatayim: 'Ramat Gan & Givatayim',
  holon_bat_yam: 'Holon & Bat Yam',
  bnei_brak: 'Bnei Brak',
  herzliya_sharon: 'Herzliya & Sharon',
  petah_tikva: 'Petah Tikva',
  rishon_rehovot: 'Rishon & Rehovot',
  other: 'Other',
}

export const KINDS = ['collection', 'sorting', 'preparation', 'inventory', 'donation_event', 'loading', 'transport', 'event', 'other'] as const
export type ActivityKind = (typeof KINDS)[number]
export const KIND_HE: Record<ActivityKind, string> = {
  collection: 'איסוף רהיטים מבניינים',
  sorting: 'מיון במחסן',
  preparation: 'הכנת רהיטים לשימוש חוזר',
  inventory: 'סידור מלאי',
  donation_event: 'יום תרומות קהילתי',
  loading: 'העמסה ופריקה',
  transport: 'הסעות ושינוע',
  event: 'אירוע מיוחד',
  other: 'התנדבות אחרת',
}
export const KIND_EN: Record<ActivityKind, string> = {
  collection: 'Furniture collection',
  sorting: 'Warehouse sorting',
  preparation: 'Preparing furniture',
  inventory: 'Organising inventory',
  donation_event: 'Community donation event',
  loading: 'Loading & unloading',
  transport: 'Transport',
  event: 'Special event',
  other: 'Other',
}

export const SKILLS = ['lifting', 'driving', 'truck_license', 'carpentry', 'upholstery', 'painting', 'sorting', 'photography', 'social_media', 'events'] as const
export type Skill = (typeof SKILLS)[number]
export const SKILL_HE: Record<Skill, string> = {
  lifting: 'הרמה וסחיבה',
  driving: 'נהיגה (רישיון B)',
  truck_license: 'רישיון משאית',
  carpentry: 'נגרות',
  upholstery: 'ריפוד',
  painting: 'צביעה ושיוף',
  sorting: 'מיון וסידור',
  photography: 'צילום',
  social_media: 'רשתות חברתיות',
  events: 'הפקת אירועים',
}
export const SKILL_EN: Record<Skill, string> = {
  lifting: 'Lifting & carrying',
  driving: 'Driving (B licence)',
  truck_license: 'Truck licence',
  carpentry: 'Carpentry',
  upholstery: 'Upholstery',
  painting: 'Painting & sanding',
  sorting: 'Sorting',
  photography: 'Photography',
  social_media: 'Social media',
  events: 'Events',
}

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type Day = (typeof DAYS)[number]
export const DAY_HE: Record<Day, string> = { sun: 'ראשון', mon: 'שני', tue: 'שלישי', wed: 'רביעי', thu: 'חמישי', fri: 'שישי', sat: 'שבת' }
export const DAY_EN: Record<Day, string> = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' }
export const PARTS = ['morning', 'afternoon', 'evening'] as const
export type DayPart = (typeof PARTS)[number]
export const PART_HE: Record<DayPart, string> = { morning: 'בוקר', afternoon: 'צהריים', evening: 'ערב' }
export const PART_EN: Record<DayPart, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' }
/** Israel wall-clock hours each part covers: [from, to). */
export const PART_HOURS: Record<DayPart, [number, number]> = { morning: [6, 12], afternoon: [12, 16], evening: [16, 23] }
export type Slot = `${Day}_${DayPart}`
export const SLOTS = DAYS.flatMap((d) => PARTS.map((p) => `${d}_${p}` as Slot))

export const TRANSPORT = ['none', 'car', 'van'] as const
export type Transport = (typeof TRANSPORT)[number]
export const TRANSPORT_HE: Record<Transport, string> = { none: 'אין לי רכב', car: 'יש לי רכב פרטי', van: 'יש לי רכב מסחרי / טנדר' }
export const TRANSPORT_EN: Record<Transport, string> = { none: 'No vehicle', car: 'Car', van: 'Van / pickup' }

export const VOLUNTEER_STATUSES = ['active', 'paused', 'blocked', 'deleted'] as const
export type VolunteerStatus = (typeof VOLUNTEER_STATUSES)[number]
export const VOLUNTEER_STATUS_EN: Record<VolunteerStatus, string> = { active: 'Active', paused: 'Paused', blocked: 'Blocked', deleted: 'Deleted' }

export const ACTIVITY_STATUSES = ['draft', 'published', 'cancelled', 'completed'] as const
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number]
export const ACTIVITY_STATUS_EN: Record<ActivityStatus, string> = { draft: 'Draft', published: 'Published', cancelled: 'Cancelled', completed: 'Completed' }

export const SIGNUP_STATUSES = ['invited', 'confirmed', 'waitlisted', 'cancelled', 'declined', 'removed'] as const
export type SignupStatus = (typeof SIGNUP_STATUSES)[number]
export const SIGNUP_STATUS_HE: Record<SignupStatus, string> = { invited: 'הוזמנת', confirmed: 'רשום/ה', waitlisted: 'ברשימת המתנה', cancelled: 'בוטל', declined: 'נדחתה ההזמנה', removed: 'הוסר/ה' }
export const SIGNUP_STATUS_EN: Record<SignupStatus, string> = { invited: 'Invited', confirmed: 'Confirmed', waitlisted: 'Waitlisted', cancelled: 'Cancelled', declined: 'Declined', removed: 'Removed' }
/** A sign-up that still means "this person is coming / may come". */
export const LIVE: readonly SignupStatus[] = ['invited', 'confirmed', 'waitlisted']

export const ATTENDANCE = ['unknown', 'present', 'absent', 'excused'] as const
export type Attendance = (typeof ATTENDANCE)[number]
export const ATTENDANCE_EN: Record<Attendance, string> = { unknown: 'Not recorded', present: 'Present', absent: 'No-show', excused: 'Excused' }
export const ATTENDANCE_HE: Record<Attendance, string> = { unknown: 'טרם נרשמה נוכחות', present: 'השתתפת', absent: 'לא הגעת', excused: 'שוחררת' }

export const MIN_AGE = 16

// ── Records ────────────────────────────────────────────────────────────────

export interface Volunteer {
  id: string
  contactId: string | null
  fullName: string
  email: string | null
  phone: string | null
  adult: boolean
  ageConfirmedAt: string
  areas: Area[]
  availability: Slot[]
  skills: Skill[]
  transport: Transport
  about: string | null
  notifyReminders: boolean
  notifyOpportunities: boolean
  consentWhatsapp: boolean
  consentAt: string
  status: VolunteerStatus
  sessionVersion: number
  source: 'app' | 'staff' | 'website_form'
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Activity {
  id: string
  title: string
  summary: string | null
  description: string | null
  kind: ActivityKind
  status: ActivityStatus
  furnitureProjectId: string | null
  furnitureProjectName: string | null
  locationName: string | null
  address: string | null
  area: Area | null
  mapUrl: string | null
  arrivalInfo: string | null
  requirements: string | null
  equipment: string | null
  instructions: string | null
  adultsOnly: boolean
  requiredSkills: Skill[]
  coordinatorProfileId: string | null
  coordinatorName: string | null
  contactPhone: string | null
  photoUrls: string[]
  signupClosesHours: number
  seriesId: string | null
  cancelReason: string | null
  cancelledAt: string | null
  version: number
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface Shift {
  id: string
  activityId: string
  label: string | null
  role: string | null
  startsAt: string
  endsAt: string
  capacity: number
  minVolunteers: number
  status: 'open' | 'cancelled'
  checkinCode: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface Signup {
  id: string
  shiftId: string
  volunteerId: string
  status: SignupStatus
  source: 'self' | 'invite' | 'staff' | 'walk_in'
  queuedAt: string | null
  invitedBy: string | null
  cancelledAt: string | null
  cancelReason: string | null
  attendance: Attendance
  checkInAt: string | null
  checkOutAt: string | null
  minutes: number | null
  attendanceMethod: 'coordinator' | 'qr' | 'full_shift' | 'correction' | null
  attendanceBy: string | null
  attendanceNote: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface VolEvent {
  id: string
  at: string
  signupId: string | null
  shiftId: string | null
  volunteerId: string | null
  kind: string
  actor: string
  detail: Record<string, unknown>
}

export interface VolNote {
  id: string
  volunteerId: string
  body: string
  authorEmail: string
  at: string
}

export interface OutboxRow {
  id: string
  volunteerId: string | null
  toEmail: string | null
  channel: 'email'
  kind: string
  dedupeKey: string
  subject: string
  body: string
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'
  notBefore: string
  attempts: number
  lastError: string | null
  sentAt: string | null
  claimedAt: string | null
  createdAt: string
}

// ── Inputs ─────────────────────────────────────────────────────────────────

export interface RegistrationInput {
  fullName: string
  email: string
  phone: string
  adult: boolean
  areas: Area[]
  availability: Slot[]
  skills: Skill[]
  transport: Transport
  about: string | null
  notifyReminders: boolean
  notifyOpportunities: boolean
  consentWhatsapp: boolean
  source?: Volunteer['source']
  actor?: string
}

export type ProfilePatch = Partial<Pick<Volunteer, 'fullName' | 'phone' | 'adult' | 'areas' | 'availability' | 'skills' | 'transport' | 'about' | 'notifyReminders' | 'notifyOpportunities' | 'consentWhatsapp'>>

export type ActivityInput = Pick<Activity, 'title' | 'kind'> &
  Partial<Pick<Activity,
    'summary' | 'description' | 'status' | 'furnitureProjectId' | 'furnitureProjectName' | 'locationName' | 'address' | 'area' | 'mapUrl' | 'arrivalInfo' |
    'requirements' | 'equipment' | 'instructions' | 'adultsOnly' | 'requiredSkills' | 'coordinatorProfileId' | 'coordinatorName' | 'contactPhone' | 'photoUrls' |
    'signupClosesHours' | 'seriesId'>>

export interface ShiftInput {
  label: string | null
  role: string | null
  startsAt: string
  endsAt: string
  capacity: number
  minVolunteers: number
}

const pick = <T extends string>(all: readonly T[], v: readonly unknown[]): T[] => [...new Set(v.map(String).filter((x): x is T => (all as readonly string[]).includes(x)))]
export const pickAreas = (v: readonly unknown[]) => pick(AREAS, v)
export const pickSkills = (v: readonly unknown[]) => pick(SKILLS, v)
export const pickSlots = (v: readonly unknown[]) => pick(SLOTS, v)

/** A real name: two words or more, letters only (Hebrew or Latin), 2–80 characters. */
export function isFullName(v: string): boolean {
  const t = v.trim().replace(/\s+/g, ' ')
  return t.length >= 3 && t.length <= 80 && /^[\p{L}'׳"״\-. ]+$/u.test(t) && t.split(' ').filter((w) => w.replace(/[^\p{L}]/gu, '').length > 0).length >= 2
}

/** An Israeli mobile, normalised (0501234567), or null. */
export function israeliMobile(v: string | null | undefined): string | null {
  const p = normalizePhone(v)
  return p && /^05\d{8}$/.test(p) ? p : null
}

/** The registration fields that can block sign-up, in the order they appear on the form. */
export const SIGNUP_REQUIRED = ['fullName', 'phone', 'age16', 'consent'] as const
export type SignupField = (typeof SIGNUP_REQUIRED)[number]
export const SIGNUP_FIELD_HE: Record<SignupField, string> = { fullName: 'שם מלא', phone: 'טלפון נייד', age16: `אישור גיל ${MIN_AGE}+`, consent: 'הסכמה לאימיילים' }

/**
 * Every problem with a registration at once, keyed by field, in Hebrew. Run by
 * the join form before it submits and again by the server action, so a person
 * sees everything still missing in one go instead of one message per attempt.
 */
export function signupProblems(f: { fullName?: string | null; phone?: string | null; age16?: boolean; consent?: boolean }): Partial<Record<SignupField, string>> {
  const out: Partial<Record<SignupField, string>> = {}
  const name = (f.fullName ?? '').trim()
  if (!name) out.fullName = 'חסר שם מלא.'
  else if (!isFullName(name)) out.fullName = 'נא לכתוב שם פרטי ושם משפחה, באותיות בלבד.'
  const phone = (f.phone ?? '').trim()
  if (!phone) out.phone = 'חסר מספר טלפון נייד.'
  else if (!israeliMobile(phone)) out.phone = 'זה לא נראה כמו נייד ישראלי. למשל 050-123-4567.'
  if (!f.age16) out.age16 = `ההתנדבות פתוחה מגיל ${MIN_AGE}. נא לסמן שזה נכון.`
  if (!f.consent) out.consent = 'בלי הסכמה לאימיילים לא נוכל לשלוח אישורים ועדכונים על המשמרות. נא לסמן.'
  return out
}

/** One line naming what is still missing, in form order: "עוד 2 פרטים חסרים או לא תקינים: שם מלא, טלפון נייד." */
export function signupSummary(errors: Partial<Record<SignupField, string>>): string {
  const names = SIGNUP_REQUIRED.filter((k) => errors[k]).map((k) => SIGNUP_FIELD_HE[k])
  return names.length === 1 ? `עוד פרט אחד חסר או לא תקין: ${names[0]}.` : `עוד ${names.length} פרטים חסרים או לא תקינים: ${names.join(', ')}.`
}

/** Shift input problems, in English for staff. Times are ISO instants. */
export function shiftProblem(s: ShiftInput): string | null {
  const a = Date.parse(s.startsAt)
  const b = Date.parse(s.endsAt)
  if (Number.isNaN(a) || Number.isNaN(b)) return 'Give the shift a valid date, start and end time.'
  if (b <= a) return 'The shift must end after it starts.'
  if (b - a > 24 * 3_600_000) return 'A shift cannot be longer than 24 hours.'
  if (!Number.isInteger(s.capacity) || s.capacity < 1 || s.capacity > 500) return 'Capacity must be a whole number from 1 to 500.'
  if (!Number.isInteger(s.minVolunteers) || s.minVolunteers < 0 || s.minVolunteers > s.capacity) return 'The minimum must be between 0 and the capacity.'
  return null
}

/** Only https links are stored for maps and photos. */
export function httpsUrl(v: string | null | undefined): string | null {
  const t = v?.trim()
  if (!t) return null
  try {
    const u = new URL(t)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}
