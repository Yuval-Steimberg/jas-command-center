import './globals.css'
import type { Metadata, Viewport } from 'next'
import { BottomNav } from '@/components/nav'
import { RegisterServiceWorker } from '@/components/sw-register'
import { currentVolunteer } from '@/lib/session'

export const metadata: Metadata = {
  title: { default: 'JAS Volunteers · מתנדבים ב-Just A Second', template: '%s · JAS Volunteers' },
  description: 'מתנדבים עם Just A Second: איסוף רהיטים, מיון, הכנה לשימוש חוזר ואירועים קהילתיים. בוחרים משמרת ונרשמים בלחיצה.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'JAS מתנדבים', statusBarStyle: 'default' },
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#FFFCF5', viewportFit: 'cover' }
export const dynamic = 'force-dynamic'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const v = await currentVolunteer().catch(() => null)
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800&family=Secular+One&display=swap" />
      </head>
      <body className="min-h-dvh font-sans text-base">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:right-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-forest focus:px-4 focus:py-2 focus:text-ground">לדילוג לתוכן</a>
        <div id="main">{children}</div>
        <BottomNav signedIn={Boolean(v)} />
        <RegisterServiceWorker />
      </body>
    </html>
  )
}
