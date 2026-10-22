'use client'

import { useFormState } from 'react-dom'
import { moderateReviewsAction, replyReviewAction, type ActionState } from './actions'
import { Result, Submit } from './forms'

const LABEL: Record<string, string> = { approve: 'Approve', hide: 'Hide', delete: 'Delete' }

function confirmFor(op: string, n: number) {
  const what = n === 1 ? 'this review' : `${n} reviews`
  if (op === 'delete') return `Delete ${what} permanently? Hiding can be undone; deleting cannot.`
  if (op === 'approve') return `Show ${what} on the public site?`
  return `Hide ${what} from the public site?`
}

/** One review's buttons. The submitter's value picks the operation. */
export function ReviewActions({ id, approved }: { id: number; approved: boolean }) {
  const [state, action] = useFormState<ActionState, FormData>(moderateReviewsAction, {})
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const op = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? ''
        if (!window.confirm(confirmFor(op, 1))) e.preventDefault()
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap gap-2">
        {(approved ? ['hide', 'delete'] : ['approve', 'delete']).map((op) => (
          <button key={op} name="op" value={op} className={op === 'approve' ? 'h-10 rounded-full bg-brand px-4 text-sm font-semibold text-forest hover:bg-brand-pressed hover:text-cream' : op === 'delete' ? 'h-10 rounded-full border border-line px-4 text-sm font-medium text-bad hover:bg-sunken' : 'h-10 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken'}>
            {LABEL[op]}
          </button>
        ))}
      </div>
      <Result state={state} />
    </form>
  )
}

/** Bulk bar: the checkboxes on the page join this form through form="reviews-bulk". */
export function BulkModerate() {
  const [state, action] = useFormState<ActionState, FormData>(moderateReviewsAction, {})
  return (
    <form
      id="reviews-bulk"
      action={action}
      onSubmit={(e) => {
        const op = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? ''
        const n = new FormData(e.currentTarget).getAll('id').length
        if (!n) {
          e.preventDefault()
          window.alert('Tick at least one review first.')
          return
        }
        if (!window.confirm(confirmFor(op, n))) e.preventDefault()
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Ticked reviews:</span>
        {['approve', 'hide', 'delete'].map((op) => (
          <button key={op} name="op" value={op} className="h-10 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken">{LABEL[op]}</button>
        ))}
      </div>
      <Result state={state} />
    </form>
  )
}

export function ReviewReplyForm({ id, reply }: { id: number; reply: string }) {
  const [state, action] = useFormState<ActionState, FormData>(replyReviewAction, {})
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="was" value={reply} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Reply (kept with the review, as in the website manager)</span>
        <textarea name="reply" defaultValue={reply} maxLength={2000} rows={2} dir="auto" className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" />
      </label>
      <div><Submit label="Save reply" busy="Saving…" /></div>
      <Result state={state} />
    </form>
  )
}
