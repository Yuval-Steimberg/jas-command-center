import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { listAudit, type AuditEntry } from '@/lib/audit/audit'
import { formatDateTime } from '@/lib/format'

const str = (v: unknown) => (typeof v === 'string' ? v : null)

/** One plain sentence per audit row: what was asked, looked up, proposed or executed. */
function describe(a: AuditEntry): string {
  const d = a.detail
  if (a.action === 'assistant.ask') {
    const used = Array.isArray(d.toolsUsed) && d.toolsUsed.length ? ` · looked up: ${d.toolsUsed.join(', ')}` : ''
    return `Asked “${str(d.question) ?? ''}”${used}`
  }
  if (a.action === 'assistant.tool') return `Looked up ${a.target ?? 'a source'}${str(d.error) ? `: ${str(d.error)}` : ''}`
  if (a.action === 'assistant.propose') return `Proposed ${str(d.summary) ?? a.target ?? 'an action'}`
  const msg = str(d.message) ?? str(d.error)
  return `${a.outcome === 'requested' ? 'Confirmed' : 'Ran'} ${a.action}${a.target ? ` on ${a.target}` : ''}${msg ? `: ${msg}` : ''}`
}

const TONE: Record<AuditEntry['outcome'], string> = { requested: 'text-muted', succeeded: 'text-ok', failed: 'text-bad', denied: 'text-bad' }

/**
 * What the assistant was asked, what it looked up, what it proposed, and what a
 * person confirmed and how that ended — straight from the audit log. People see
 * their own history; audit:read sees everyone's.
 */
export async function AssistantHistory({ userId, everyone }: { userId: string; everyone: boolean }) {
  let rows: AuditEntry[]
  try {
    rows = await listAudit(60, { via: 'assistant', ...(everyone ? {} : { actorId: userId }) })
  } catch (e) {
    return (
      <Card className="mt-4">
        <CardHeader title="AI activity" />
        <CardBody><p className="text-sm text-bad">Could not read the audit log: {e instanceof Error ? e.message : String(e)}</p></CardBody>
      </Card>
    )
  }
  return (
    <Card className="mt-4">
      <CardHeader title="AI activity" meta={everyone ? 'Everyone, newest first' : 'Your questions and actions, newest first'} />
      <CardBody>
        {!rows.length ? <p className="text-sm text-muted">Nothing yet.</p> : (
          <ul className="divide-y divide-line/60">
            {rows.map((a) => (
              <li key={a.id} className="grid gap-x-3 gap-y-0.5 py-2 text-sm sm:grid-cols-[9.5rem_1fr_auto]">
                <span className="num text-xs text-muted">{formatDateTime(a.at)}</span>
                <span className="min-w-0 break-words" dir="auto">{describe(a)}{everyone ? <span className="text-xs text-muted"> · {a.actorEmail}</span> : null}</span>
                <span className={`text-xs ${TONE[a.outcome]}`}>{a.outcome}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
