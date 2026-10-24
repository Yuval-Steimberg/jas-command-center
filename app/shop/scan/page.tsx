import { ScanBox } from '@/app/(app)/inventory/forms'

export const dynamic = 'force-dynamic'

export default function ShopScanPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <h1 className="text-2xl font-bold text-ink">סריקת תווית</h1>
      <p className="text-sm text-muted">מכוונים את המצלמה לתווית, או מקלידים את הקוד. סורק USB או Bluetooth עובד ישר בשדה.</p>
      <ScanBox base="/shop" lang="he" />
    </div>
  )
}
