import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { requirePageAccess } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export default async function AssistantPage() {
  await requirePageAccess('assistant:use')
  return (
    <>
      <PageHeader title="AI assistant" description="Not built yet — on purpose." />
      <Card>
        <CardHeader title="Why it is not here yet" />
        <CardBody className="flex flex-col gap-3 text-sm text-muted">
          <p>
            An assistant that answers “how is the business doing” is only as good as the tools it can call. Those tools are the adapters on the other pages, and four of five are
            waiting on credentials. Shipping a chat box before they return real data would produce confident answers about nothing.
          </p>
          <p>
            The design agent (whatssup-bot) already contains a JAS AI manager with specialist agents, approvals and a cost budget. Whether the command center gets its own
            assistant over these adapters, or drives that one, is an open decision recorded in docs/INTEGRATION_INVENTORY.md §7.
          </p>
          <p>
            Whichever it is, it will call only the typed, permission-checked functions in lib/integrations, ask for confirmation before any write, and record every request and
            result in the audit log with via = assistant.
          </p>
        </CardBody>
      </Card>
    </>
  )
}
