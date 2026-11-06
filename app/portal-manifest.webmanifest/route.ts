/** Makes /portal installable ("Add to home screen"). Public on purpose: it holds no data. */
export const dynamic = 'force-static'

export function GET() {
  return Response.json(
    {
      name: 'JAS · פורטל הצוות',
      short_name: 'JAS צוות',
      description: 'Just A Second: כל כלי העבודה במקום אחד.',
      lang: 'he',
      dir: 'rtl',
      start_url: '/portal',
      scope: '/',
      display: 'standalone',
      background_color: '#FFFCF5',
      theme_color: '#333D36',
      icons: [
        { src: '/shop-icon?size=192', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/shop-icon?size=512', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=86400' } },
  )
}
