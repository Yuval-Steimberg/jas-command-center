import 'server-only'
import QRCode from 'qrcode'
import { env } from '@/lib/env'

/** The URL a label's QR code opens: the item page (the scan page also accepts it). */
export const itemUrl = (id: string) => `${env().cc.appUrl}/inventory/${id}`

/** An inline SVG QR code, rendered on the server: no image host, works offline once printed. */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#333D36', light: '#FFFFFF' } })
}
