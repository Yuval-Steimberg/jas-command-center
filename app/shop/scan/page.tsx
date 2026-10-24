import { ScanBox } from '@/app/(app)/inventory/forms'

export const dynamic = 'force-dynamic'

export default function ShopScanPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <h1 className="text-xl font-bold text-ink">סריקת תווית</h1>
      <p className="text-sm text-muted">סורק USB או Bluetooth מקליד את הקוד ולוחץ Enter. בטלפון אפשר לסרוק במצלמה, או להקליד את הקוד.</p>
      <ScanBox base="/shop" lang="he" />
    </div>
  )
}
