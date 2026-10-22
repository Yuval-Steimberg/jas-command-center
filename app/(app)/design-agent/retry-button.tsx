'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { retryJobAction, type RetryState } from './actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button disabled={pending} className="h-8 rounded-full border border-line px-3 text-xs font-medium hover:bg-sunken disabled:opacity-60">
      {pending ? 'Retrying…' : 'Retry'}
    </button>
  )
}

export function RetryButton({ jobId, type }: { jobId: number; type: string }) {
  const [state, action] = useFormState<RetryState, FormData>(retryJobAction, {})
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Re-queue ${type} job ${jobId}? It will run again from its last saved step.`)) e.preventDefault()
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="jobId" value={jobId} />
      <Submit />
      {state.message ? <p role="status" className={state.ok ? 'text-meta text-ok' : 'text-meta text-bad'}>{state.message}</p> : null}
    </form>
  )
}
