import 'server-only'
import type { Item } from '@/lib/ops/types'
import { itemUrl, qrSvg } from '@/lib/inventory/qr'
import { barcodeSvg, isEncodable } from '@/lib/inventory/barcode'
import { formatAgorot } from '@/lib/money'

/**
 * The printable label sheet, shared by /inventory/labels and /shop/labels.
 * Each label carries a QR (a phone camera opens the item) AND a Code 128
 * barcode of the code (what a 1D USB/Bluetooth shop scanner reads).
 */
export async function LabelSheet({ items, lang = 'en' }: { items: Item[]; lang?: 'en' | 'he' }) {
  const labels = await Promise.all(items.map(async (i) => ({ i, qr: await qrSvg(itemUrl(i.id)), bars: isEncodable(i.sku) ? barcodeSvg(i.sku) : null })))
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 print:gap-2">
      {labels.map(({ i, qr, bars }) => (
        <div key={i.id} dir="ltr" className="flex break-inside-avoid flex-col gap-1 rounded-md border border-line bg-white p-2 text-forest">
          <div className="flex items-center gap-2">
            <div className="h-20 w-20 shrink-0" aria-label={`QR ${i.sku}`} dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="min-w-0 text-xs">
              <p className="font-mono text-sm font-bold">{i.sku}</p>
              <p dir="auto" className="line-clamp-2">{i.title}</p>
              {i.priceMinor ? <p className="num font-semibold">{formatAgorot(i.priceMinor)}</p> : null}
            </div>
          </div>
          {bars ? <div className="h-9 w-full" aria-label={lang === 'he' ? `ברקוד ${i.sku}` : `Barcode ${i.sku}`} dangerouslySetInnerHTML={{ __html: bars.replace('<svg ', '<svg width="100%" height="100%" ') }} /> : null}
        </div>
      ))}
    </div>
  )
}
