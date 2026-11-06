import { Building2, HandHeart, Link2, MapPin, Package, Palette, Settings, type LucideIcon } from 'lucide-react'
import { AUDIENCE_LABEL, type Audience, type PortalIcon } from '@/lib/portal/model'
import { cn } from '@/lib/cn'

export const PORTAL_ICON: Record<PortalIcon, LucideIcon> = {
  volunteers: HandHeart,
  mapping: Building2,
  inventory: Package,
  design: Palette,
  map: MapPin,
  admin: Settings,
  link: Link2,
}

export const ICON_LABEL: Record<PortalIcon, string> = {
  volunteers: 'מתנדבים',
  mapping: 'בניין',
  inventory: 'מלאי',
  design: 'עיצוב',
  map: 'מפה',
  admin: 'ניהול',
  link: 'קישור',
}

export function CategoryIcon({ icon, size = 'md' }: { icon: PortalIcon; size?: 'md' | 'lg' }) {
  const Icon = PORTAL_ICON[icon] ?? Link2
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-md bg-sage-soft text-forest', size === 'lg' ? 'size-12' : 'size-10')}>
      <Icon className={size === 'lg' ? 'size-6' : 'size-5'} strokeWidth={1.75} />
    </span>
  )
}

/** Spec page 2, "סימונים במסך": who a link is for. Colour + word, never colour alone. */
export const AUDIENCE_TONE: Record<Audience, string> = {
  customer: 'bg-brand/15 text-brand-ink',
  team: 'bg-sage-soft text-forest',
  manager: 'bg-forest/10 text-forest',
}

export function AudienceTag({ audience }: { audience: Audience }) {
  return <span className={cn('inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-medium', AUDIENCE_TONE[audience])}>{AUDIENCE_LABEL[audience]}</span>
}

/** "בוקר טוב" by the hour in Israel. */
export function greeting(now = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Jerusalem' }).format(now))
  if (h >= 5 && h < 12) return 'בוקר טוב'
  if (h >= 12 && h < 17) return 'צהריים טובים'
  if (h >= 17 && h < 22) return 'ערב טוב'
  return 'לילה טוב'
}

/** A first name when the profile has one written in letters; otherwise the team. */
export function firstName(name: string): string | null {
  const first = name.trim().split(/\s+/)[0] ?? ''
  if (!first || first.includes('@') || /\d/.test(first)) return null
  return first
}
