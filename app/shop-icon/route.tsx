import { ImageResponse } from 'next/og'

/** The shop app's home-screen icon: the JAS mark in cream on forest. Public; no data. */
export function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get('size'))
  const size = [180, 192, 512].includes(raw) ? raw : 192
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#333D36', color: '#FFFCF5', fontSize: size * 0.34, fontWeight: 900, letterSpacing: -size * 0.01 }}>
        JAS
        <div style={{ position: 'absolute', bottom: size * 0.2, width: size * 0.16, height: size * 0.04, borderRadius: size, background: '#E88225' }} />
      </div>
    ),
    { width: size, height: size, headers: { 'Cache-Control': 'public, max-age=86400' } },
  )
}
