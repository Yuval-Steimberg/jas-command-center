import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { requirePageAccess, userCan } from '@/lib/auth/session'
import { env } from '@/lib/env'
import { TOOLS } from '@/lib/assistant/tools'
import { AssistantChat } from './chat'

export const dynamic = 'force-dynamic'
// One question can take several tool rounds; the action stops itself at 45 s.
export const maxDuration = 60

export default async function AssistantPage() {
  await requirePageAccess('assistant:use')
  const configured = Boolean(env().assistant.apiKey)
  const allowed = await Promise.all(TOOLS.map(async (t) => ((await userCan(t.permission)) ? t : null)))
  const tools = allowed.filter((t): t is (typeof TOOLS)[number] => t !== null)

  return (
    <>
      <PageHeader
        title="AI assistant"
        description="Ask about the business in Hebrew or English. It reads the same live sources as the other pages, only for products your role can see, and it cannot change anything."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardBody>
            {configured ? (
              <AssistantChat labels={Object.fromEntries(tools.map((t) => [t.name, t.label]))} />
            ) : (
              <p className="text-sm text-muted">
                Not configured: set <code className="rounded bg-sunken px-1">ANTHROPIC_API_KEY</code> on this deployment and redeploy. Until then the assistant is off; nothing is simulated.
              </p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="What it can check" meta="Read-only. Every question and lookup is in the audit log." />
          <CardBody>
            {tools.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {tools.map((t) => (
                  <li key={t.name} className="text-ink">
                    {t.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Your role cannot read any product, so the assistant has nothing to check.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  )
}
