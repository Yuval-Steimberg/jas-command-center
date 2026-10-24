import Link from 'next/link'
import { cn } from '@/lib/cn'

/** One orange action per screen: this is it. Forest text on the orange fill, large and bold (3:1 large-text contrast). */
export const primaryBtn =
  'inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-brand px-6 text-lg font-bold text-forest shadow-1 transition duration-150 ease-standard hover:bg-brand-pressed active:scale-[0.98] disabled:opacity-60'
export const secondaryBtn =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-forest/25 bg-ground px-5 text-base font-semibold text-forest transition duration-150 ease-standard hover:bg-cream2 active:scale-[0.98] disabled:opacity-60'
export const quietBtn = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-4 text-base font-medium text-slate underline-offset-4 hover:underline'
export const input =
  'block min-h-12 w-full rounded-lg border border-line bg-paper px-4 text-base text-ink placeholder:text-slate/60 focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20'

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <main className={cn('mx-auto w-full max-w-xl px-4 pb-nav pt-4', className)}>{children}</main>
}

export function Title({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <header className="mb-5">
      <h1 className="font-display text-[1.75rem] leading-tight text-forest">{children}</h1>
      {sub ? <p className="mt-1.5 text-base leading-relaxed text-slate">{sub}</p> : null}
    </header>
  )
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold text-forest">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Card({ children, className, tone = 'paper' }: { children: React.ReactNode; className?: string; tone?: 'paper' | 'sage' | 'cream' }) {
  return (
    <div className={cn('rounded-lg border p-4', tone === 'paper' && 'border-line bg-paper shadow-1', tone === 'sage' && 'border-sage-deep/30 bg-sage-soft', tone === 'cream' && 'border-line bg-cream2', className)}>
      {children}
    </div>
  )
}

export function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'sage' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-medium',
        tone === 'neutral' && 'border-line bg-ground text-slate',
        tone === 'ok' && 'border-ok/30 bg-ok/10 text-ok',
        tone === 'warn' && 'border-warn/30 bg-warn/10 text-warn',
        tone === 'bad' && 'border-bad/30 bg-bad/10 text-bad',
        tone === 'sage' && 'border-sage-deep/40 bg-sage-soft text-forest',
      )}
    >
      {children}
    </span>
  )
}

export function Notice({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'bad'; children: React.ReactNode }) {
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cn('rounded-lg border px-4 py-3 text-base leading-relaxed', tone === 'neutral' && 'border-line bg-cream2 text-ink', tone === 'ok' && 'border-ok/30 bg-ok/10 text-ink', tone === 'bad' && 'border-bad/30 bg-bad/10 text-ink')}>
      {children}
    </div>
  )
}

export function Empty({ title, children, href, cta }: { title: string; children?: React.ReactNode; href?: string; cta?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-cream2/60 px-5 py-7 text-center">
      <p className="text-lg font-semibold text-forest">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-sm text-base leading-relaxed text-slate">{children}</p> : null}
      {href && cta ? <Link href={href} className={cn(secondaryBtn, 'mt-4')}>{cta}</Link> : null}
    </div>
  )
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="block">
      <label htmlFor={htmlFor} className="mb-1.5 block text-base font-semibold text-forest">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-sm text-slate">{hint}</p> : null}
    </div>
  )
}

/** Toggle chips over checkboxes: large targets, keyboard and screen-reader friendly. */
export function Chips({ name, options, selected, legend }: { name: string; options: { value: string; label: string }[]; selected: readonly string[]; legend: string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-base font-semibold text-forest">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="cursor-pointer">
            <input type="checkbox" name={name} value={o.value} defaultChecked={selected.includes(o.value)} className="peer sr-only" />
            <span className="inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4 text-base text-ink transition peer-checked:border-forest peer-checked:bg-forest peer-checked:text-ground peer-focus-visible:ring-2 peer-focus-visible:ring-forest/40">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
