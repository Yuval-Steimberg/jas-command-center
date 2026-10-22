'use client'

import { useFormState } from 'react-dom'
import { setInquiryHandledAction, type ActionState } from './actions'
import { Result, Submit } from './forms'

export function InquiryHandled({ id, kind, handled }: { id: number; kind: string; handled: boolean }) {
  const [state, action] = useFormState<ActionState, FormData>(setInquiryHandledAction, {})
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="handled" value={String(!handled)} />
      <div><Submit label={handled ? 'Reopen' : 'Mark handled'} busy="Saving…" tone={handled ? 'plain' : 'primary'} /></div>
      <Result state={state} />
    </form>
  )
}
