'use server'

import { getSession } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { skuCandidates } from '@/lib/inventory/model'
import { appUrls } from '@/lib/portal/service'
import { classifyScan } from '@/lib/portal/today'

export type ScanOutcome = { ok: true; href: string; external: boolean } | { ok: false; message: string }

/**
 * One scan or typed code → the screen for it. An item label opens the item;
 * a gift card (its QR or its printed code) opens the gift card system's
 * redemption screen on that card, where the person's own login there decides
 * what they may do. Read-only: nothing is changed or recorded here.
 */
export async function scanAct(raw: string): Promise<ScanOutcome> {
  const s = await getSession()
  if (!s) return { ok: false, message: 'צריך להתחבר מחדש.' }
  const code = typeof raw === 'string' ? raw : ''
  const what = classifyScan(code)
  if (what.kind === 'empty') return { ok: false, message: 'לא נקלט קוד. אפשר לסרוק שוב או להקליד אותו.' }

  if (what.kind === 'gift_code' || what.kind === 'gift_url') {
    const base = appUrls().gift_cards
    if (!base) return { ok: false, message: 'זה שובר מתנה, אבל הכתובת של מערכת השוברים לא מוגדרת כאן (GIFT_CARDS_URL).' }
    // The redemption screen looks the card up by code or by the scanned link itself (it extracts the token).
    const value = what.kind === 'gift_code' ? what.code : code.trim()
    return { ok: true, href: `${base.replace(/\/$/, '')}/employee?code=${encodeURIComponent(value)}`, external: true }
  }

  if (!can(s.user.role, 'inventory:read', s.overrides)) return { ok: false, message: 'אין לך הרשאה לראות פריטים במלאי.' }
  if (what.kind === 'item') return { ok: true, href: `/shop/items/${what.id}`, external: false }
  try {
    for (const sku of skuCandidates(what.code)) {
      const item = await getOpsStore().getItemBySku(sku)
      if (item) return { ok: true, href: `/shop/items/${item.id}`, external: false }
    }
  } catch {
    return { ok: false, message: 'לא הצלחנו לבדוק את המלאי כרגע. נסו שוב.' }
  }
  return { ok: false, message: `לא מצאנו פריט או שובר עם הקוד ${what.code.slice(0, 40)}.` }
}
