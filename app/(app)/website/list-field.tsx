'use client'

import { useState } from 'react'
import { useFormState } from 'react-dom'
import type { WebsiteContentList } from '@/lib/integrations/website/manage'
import { setContentAction, type ActionState } from './actions'
import { Result, Submit, input } from './forms'
import { ImageUpload } from './image-upload'

const area = 'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm'
const small = 'min-h-11 rounded-md border border-line px-3 text-sm hover:bg-sunken disabled:opacity-40'

type Row = Record<string, string>

function parse(value: string): Row[] {
  try {
    const v = JSON.parse(value)
    return Array.isArray(v) ? v.filter((r) => r && typeof r === 'object') : []
  } catch {
    return []
  }
}

/**
 * A JSON-list content key (menu, footer links, team, board…): add, remove and
 * reorder items, then save the whole list as one conditional content write.
 * The fields come from the website, which validates them again on save.
 */
export function ListField({ item }: { item: { key: string; label: string; value: string; updatedAt: string | null; list: WebsiteContentList } }) {
  const [state, action] = useFormState<ActionState, FormData>(setContentAction, {})
  const [rows, setRows] = useState<Row[]>(() => parse(item.value))
  const { fields, maxItems } = item.list
  const blank = (): Row => Object.fromEntries(fields.map((f) => [f.name, '']))
  const set = (i: number, name: string, v: string) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, [name]: v } : r)))
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = i + d
      if (j < 0 || j >= rs.length) return rs
      const next = [...rs]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Update "${item.label}" on the live site (${rows.length} items)?`)) e.preventDefault()
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="key" value={item.key} />
      <input type="hidden" name="was" value={item.value} />
      <input type="hidden" name="expectUpdatedAt" value={item.updatedAt ?? ''} />
      <input type="hidden" name="value" value={JSON.stringify(rows)} />
      <p className="text-sm text-muted">
        <span dir="auto">{item.label}</span> · <span dir="ltr" className="text-meta">{item.key}</span>
        {item.updatedAt ? null : <span className="text-meta"> · default</span>}
      </p>
      {rows.length ? (
        <ol className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <li key={i} className="rounded-md border border-line p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {fields.map((f) => (
                  <div key={f.name} className={f.type === 'textarea' ? 'flex flex-col gap-1 sm:col-span-2' : 'flex flex-col gap-1'}>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted" dir="auto">{f.label}{f.required ? ' *' : ''}</span>
                      {f.type === 'textarea' ? (
                        <textarea value={r[f.name] ?? ''} onChange={(e) => set(i, f.name, e.target.value)} maxLength={f.max} rows={3} dir="auto" className={area} />
                      ) : (
                        <input
                          value={r[f.name] ?? ''}
                          onChange={(e) => set(i, f.name, e.target.value)}
                          maxLength={f.max}
                          required={f.required}
                          dir={f.type === 'text' ? 'auto' : 'ltr'}
                          placeholder={f.type === 'path' ? '/about' : f.type === 'image' ? 'https://… or /images/…' : ''}
                          className={input}
                        />
                      )}
                    </label>
                    {f.type === 'image' ? <ImageUpload folder="content" label="Upload photo" onUploaded={(url) => set(i, f.name, url)} /> : null}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className={small} aria-label={`Move item ${i + 1} up`}>↑ Up</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className={small} aria-label={`Move item ${i + 1} down`}>↓ Down</button>
                <button type="button" onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))} className={small}>Remove</button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted">Empty: the site will show no items here.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setRows((rs) => [...rs, blank()])} disabled={rows.length >= maxItems} className={small}>
          + Add item
        </button>
        <Submit label="Save list" busy="Saving…" tone="primary" />
      </div>
      <Result state={state} />
    </form>
  )
}
