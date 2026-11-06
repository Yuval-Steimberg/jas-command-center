import type { Audience, PortalAction, PortalCategory, PortalData, PortalIcon } from './model'
import type { Permission } from '@/lib/auth/rbac'

/**
 * The portal's first set of categories and actions (spec page 3, adjusted to
 * what exists, see the plan). The SAME rows are inserted by
 * supabase/migrations/0014_portal.sql (a test keeps the two in step); after
 * that, link management edits the database and this file only serves the
 * local development login and a database the migration has not reached yet.
 */

const T0 = '2026-11-06T00:00:00.000Z'

const cat = (id: string, title: string, subtitle: string, icon: PortalIcon, sort: number): PortalCategory => ({ id, title, subtitle, icon, sort, active: true, updatedAt: T0 })

const act = (
  categoryId: string,
  sort: number,
  id: string,
  title: string,
  description: string,
  destination: string,
  permission: Permission | null,
  audience: Audience = 'team',
  active = true,
): PortalAction => ({ id, categoryId, title, description, destination, permission, audience, sort, active, updatedAt: T0 })

export const SEED_CATEGORIES: PortalCategory[] = [
  cat('volunteers', 'מתנדבים ושיבוצים', 'מי מגיע, מי חסר ומי מחליף', 'volunteers', 1),
  cat('mapping', 'מיפוי ופינוי דירות', 'הבניינים שאנחנו מפנים', 'mapping', 2),
  cat('inventory', 'מלאי ומכירה', 'חיפוש, מכירה ופריטים חדשים', 'inventory', 3),
  cat('design', 'עיצוב ותקשורת', 'הודעות, תזכורות וחומרי עבודה', 'design', 4),
  cat('map', 'מפה אזורית', 'המקומות בשכונה', 'map', 5),
  cat('admin', 'ניהול', 'קישורים, צוות ומצב המערכות', 'admin', 6),
]

export const SEED_ACTIONS: PortalAction[] = [
  act('volunteers', 1, 'schedule', 'לוח שיבוצים', 'מי מגיע בכל יום, מי חסר ומי יכול להחליף', '/schedule', 'volunteers:read_pii'),
  act('volunteers', 2, 'volunteers-weekly', 'מי מגיע כל שבוע', 'הצוות הקבוע של כל יום וכמה צריך', '/schedule/team', 'volunteers:read_pii'),
  act('volunteers', 3, 'attendance', 'עדכון נוכחות', 'סימון מי הגיע למשמרת', '/volunteers/calendar', 'volunteers:operate'),
  act('volunteers', 4, 'volunteers-manage', 'ניהול מתנדבים', 'רשימת המתנדבים, פעילויות ודוחות', '/volunteers', 'volunteers:read', 'manager'),
  act('volunteers', 5, 'volunteer-absence', 'קישור לדיווח היעדרות', 'למתנדבים: נכנסים מהטלפון ומדווחים שלא יגיעו', 'app:volunteers/my', 'volunteers:read', 'customer'),

  act('mapping', 1, 'map-apartment', 'מיפוי דירה', 'אפליקציית השטח: צילום ותיעוד בתוך הדירה', 'app:furniture', 'furniture:read'),
  act('mapping', 2, 'projects', 'פרויקטים והתקדמות', 'כמה נאסף בכל בניין ומה נשאר', '/furniture', 'furniture:read'),
  act('mapping', 3, 'project-new', 'פרויקט חדש', 'פתיחת בניין לפינוי עם כל הדירות', '/furniture/new', 'furniture:write', 'manager'),
  act('mapping', 4, 'intake', 'קליטת איסוף למלאי', 'פריטים שהגיעו מבניין נכנסים למחסן', '/inventory/intake', 'inventory:operate'),

  act('inventory', 1, 'item-search', 'חיפוש פריט במלאי', 'לפי שם או קוד, או סריקת מדבקה', '/shop/items', 'inventory:read'),
  act('inventory', 2, 'sale', 'רישום מכירה', 'מכירה בקופה, מזומן או אשראי', '/shop/sell', 'inventory:financial'),
  act('inventory', 3, 'item-new', 'הוספת פריט', 'צילום, פרטים ומחיר', '/shop/new', 'inventory:write'),
  act('inventory', 4, 'customer-new', 'לקוח חדש', 'שם, טלפון ומה מחפשים', '/crm/new', 'crm:write'),
  act('inventory', 5, 'shop-link', 'קישור מלאי ללקוח', 'החנות באתר: שולחים ללקוח כדי שיראה מה יש', 'app:website/shop', 'inventory:read', 'customer'),
  act('inventory', 6, 'inventory-manage', 'ניהול מלאי', 'כל הפריטים, מחירים, מיקומים ודוחות', '/inventory', 'inventory:reports', 'manager'),

  act('design', 1, 'inquiries', 'הודעות מהאתר', 'פניות מטופס יצירת קשר, התנדבות ותרומה', '/website/inquiries', 'website:read_pii'),
  act('design', 2, 'volunteer-reminder', 'תזכורת למתנדבים', 'מייל שבועי למי שמשובץ, והודעה לקבוצה', '/schedule/remind', 'volunteers:read_pii'),
  // No system behind these yet: off until someone enters the real address in link management.
  act('design', 3, 'designers-group', 'קבוצת המעצבים', 'הקבוצה בטלגרם', '', null, 'team', false),
  act('design', 4, 'materials', 'תיקיית חומרים', 'תמונות, לוגו ותבניות', '', null, 'team', false),
  act('design', 5, 'publishing', 'קישורי פרסום', 'כלים וערוצי פרסום', '', null, 'team', false),

  act('map', 1, 'map-open', 'פתיחת המפה', 'המפה השכונתית, כמו שהציבור רואה אותה', 'app:map', null, 'customer'),
  act('map', 2, 'map-edit', 'עריכת מקומות במפה', 'הוספה ותיקון של מקומות', '/map', 'map:write', 'manager'),

  act('admin', 1, 'links', 'ניהול קישורים', 'הוספה, שינוי וסדר של הכפתורים בפורטל', '/portal/manage', 'portal:manage', 'manager'),
  act('admin', 2, 'staff', 'צוות והרשאות', 'הזמנת אנשים ושינוי תפקיד', '/settings/staff', 'users:manage', 'manager'),
  act('admin', 3, 'systems', 'מצב המערכות', 'האם כל מערכת עובדת עכשיו', '/integrations', 'integrations:read', 'manager'),
  act('admin', 4, 'console', 'מערכת הניהול המלאה', 'כל המסכים המפורטים (באנגלית)', '/console', 'integrations:read', 'manager'),
]

export const seedData = (): PortalData => ({
  categories: SEED_CATEGORIES.map((c) => ({ ...c })),
  actions: SEED_ACTIONS.map((a) => ({ ...a })),
})
