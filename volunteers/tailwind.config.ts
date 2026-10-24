import type { Config } from 'tailwindcss'

// Just A Second design system (just-a-second-website/CLAUDE.md): cream ground,
// forest ink, sage surfaces, ONE orange action per screen (a fill, never text).
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: v('ground'),
        paper: v('paper'),
        cream2: v('cream-2'),
        cream3: v('cream-3'),
        line: v('line'),
        ink: v('ink'),
        slate: v('slate'),
        brand: { DEFAULT: v('brand'), pressed: v('brand-pressed'), ink: v('brand-ink') },
        sage: { DEFAULT: v('sage'), soft: v('sage-soft'), deep: v('sage-deep') },
        forest: v('forest'),
        ok: v('ok'),
        warn: v('warn'),
        bad: v('bad'),
      },
      fontFamily: {
        sans: ['Heebo', 'system-ui', 'sans-serif'],
        display: ['"Secular One"', 'Heebo', 'system-ui', 'sans-serif'],
      },
      borderRadius: { lg: '14px', xl: '22px', '2xl': '32px' },
      boxShadow: {
        1: '0 1px 2px rgb(51 61 54 / 0.06)',
        2: '0 2px 8px rgb(51 61 54 / 0.07), 0 1px 2px rgb(51 61 54 / 0.05)',
        3: '0 10px 24px rgb(51 61 54 / 0.10)',
      },
      transitionTimingFunction: { standard: 'cubic-bezier(.2,.7,.2,1)' },
    },
  },
  plugins: [],
}
export default config
