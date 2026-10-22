import type { Config } from 'tailwindcss'

// Tokens come from the Just A Second design system (just-a-second-website/CLAUDE.md),
// tuned for a dense admin surface. Every colour is a CSS variable in app/globals.css.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: v('ground'),
        surface: v('surface'),
        sunken: v('sunken'),
        line: v('line'),
        ink: v('ink'),
        muted: v('muted'),
        faint: v('faint'),
        brand: { DEFAULT: v('brand'), pressed: v('brand-pressed'), ink: v('brand-ink') },
        sage: { DEFAULT: v('sage'), soft: v('sage-soft'), deep: v('sage-deep') },
        forest: v('forest'),
        cream: v('cream'),
        ok: v('ok'),
        warn: v('warn'),
        bad: v('bad'),
      },
      fontFamily: {
        sans: ['Heebo', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: { meta: ['11px', '16px'] },
      borderRadius: { lg: '14px', md: '10px', sm: '6px' },
      boxShadow: {
        card: '0 1px 2px rgb(51 61 54 / 0.06), 0 1px 1px rgb(51 61 54 / 0.04)',
        lift: '0 4px 14px rgb(51 61 54 / 0.08)',
      },
    },
  },
  plugins: [],
}
export default config
