import type { Item } from '@/lib/ops/types'
import { BLOCKER_LABEL, BLOCKER_LABEL_HE, catalogState, websiteBlockers } from '@/lib/inventory/catalog'
import { ActionForm } from '@/app/(app)/inventory/forms'
import { catalogPhotoOffAction, remakeCatalogPhotoAction, websiteShownAction } from '@/app/(app)/inventory/actions'

const T = {
  he: {
    title: 'תמונה באתר',
    original: 'המקורית',
    catalog: 'תמונת קטלוג',
    ready: 'באתר מוצגת תמונת הקטלוג, והתמונות המקוריות בגלריה.',
    original_on: 'באתר מוצגת התמונה המקורית.',
    pending: 'תמונת הקטלוג תיווצר כשהפריט יעלה לאתר.',
    failed: 'לא נוצרה תמונת קטלוג, באתר מוצגת המקורית:',
    useOriginal: 'להשתמש בתמונה המקורית',
    useCatalog: 'להשתמש בתמונת הקטלוג',
    remake: 'ליצור תמונת קטלוג מחדש',
    working: 'שומר…',
    making: 'יוצר… (כמה שניות)',
    remakeConfirm: 'ליצור תמונת קטלוג חדשה? (עולה כ-0.10$)',
    waiting: 'יעלה לאתר לבד כש:',
    waitingJoin: ', ',
    check: 'בדקו שהפריט נראה כמו במציאות: צבע, פגמים, צורה.',
    cancel: 'לא להעלות לאתר',
    cancelConfirm: 'הפריט לא יעלה לאתר לבד. להמשיך?',
  },
  en: {
    title: 'Website photo',
    original: 'Original',
    catalog: 'Catalog photo',
    ready: 'The website shows the catalog photo, with the originals in its gallery.',
    original_on: 'The website shows the original photo.',
    pending: 'The catalog photo is made when the item goes on the website.',
    failed: 'No catalog photo was made; the website shows the original:',
    useOriginal: 'Use the original photo',
    useCatalog: 'Use the catalog photo',
    remake: 'Make the catalog photo again',
    working: 'Saving…',
    making: 'Making… (a few seconds)',
    remakeConfirm: 'Make a new catalog photo? (about $0.10)',
    waiting: 'Goes on the website by itself once:',
    waitingJoin: '; ',
    check: 'Check it looks like the real piece: colour, wear, shape.',
    cancel: "Don't put it on the website",
    cancelConfirm: 'It will not go on the website by itself. Continue?',
  },
} as const

/**
 * The item card's website-photo panel (shop + console): the original and the
 * catalog photo side by side, "use the original" / "make again", and, for an
 * item marked for the website that is not there yet, what it is waiting for.
 * Renders nothing before migration 0016.
 */
export function WebsitePhotoPanel({ item, lang, locations, canWrite, photoroom, cancelButton = false }: {
  item: Item
  lang: 'he' | 'en'
  locations: readonly { id: string; name: string }[]
  canWrite: boolean
  photoroom: boolean
  /** Show "don't put it on the website" while it waits (the shop card has its own switch). */
  cancelButton?: boolean
}) {
  const t = T[lang]
  const state = catalogState(item)
  if (state === 'unavailable') return null
  const blockers = item.websiteWanted === true && item.status === 'in_storage' ? websiteBlockers(item, locations).filter((b) => b !== 'status') : []
  const labels = lang === 'he' ? BLOCKER_LABEL_HE : BLOCKER_LABEL
  const hasCatalog = !!item.catalogPhotoUrl && item.catalogPhotoFrom === item.photoUrl
  const onSite = item.websiteProductId != null || item.websiteWanted === true
  if (!onSite && !hasCatalog) return null
  const hidden = { id: item.id }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-sm">
      <h2 className="font-semibold text-ink">{t.title}</h2>
      {blockers.length ? (
        <p role="status" className="rounded-md border border-warn/50 bg-warn/5 p-2 text-warn">{t.waiting} {blockers.map((b) => labels[b]).join(t.waitingJoin)}</p>
      ) : null}
      {cancelButton && item.websiteWanted === true && item.websiteProductId == null && item.status === 'in_storage' ? (
        <ActionForm action={websiteShownAction} hidden={{ id: item.id, show: 'false' }} label={t.cancel} busy={t.working} confirm={t.cancelConfirm} />
      ) : null}
      {hasCatalog ? (
        <div className="grid grid-cols-2 gap-2 sm:max-w-md">
          <figure className="flex flex-col gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.photoUrl!} alt={t.original} className="aspect-[4/5] w-full rounded-md border border-line object-cover" />
            <figcaption className="text-xs text-muted">{t.original}</figcaption>
          </figure>
          <figure className="flex flex-col gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.catalogPhotoUrl!} alt={t.catalog} className={`aspect-[4/5] w-full rounded-md border object-cover ${state === 'ready' ? 'border-forest' : 'border-line opacity-60'}`} />
            <figcaption className="text-xs text-muted">{t.catalog}</figcaption>
          </figure>
        </div>
      ) : null}
      <p className="text-muted">
        {state === 'ready' ? t.ready : state === 'original' ? t.original_on : state === 'failed' ? `${t.failed} ${item.catalogPhotoError ?? ''}` : state === 'pending' && photoroom ? t.pending : null}
      </p>
      {state === 'ready' ? <p className="text-xs text-muted">{t.check}</p> : null}
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          {state === 'ready' ? <ActionForm action={catalogPhotoOffAction} hidden={{ ...hidden, off: 'true' }} label={t.useOriginal} busy={t.working} /> : null}
          {state === 'original' && hasCatalog ? <ActionForm action={catalogPhotoOffAction} hidden={{ ...hidden, off: 'false' }} label={t.useCatalog} busy={t.working} /> : null}
          {photoroom && item.photoUrl && (state === 'ready' || state === 'failed' || (state === 'original' && !hasCatalog) || (state === 'pending' && item.websiteProductId != null)) ? (
            <ActionForm action={remakeCatalogPhotoAction} hidden={hidden} label={t.remake} busy={t.making} confirm={t.remakeConfirm} />
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
