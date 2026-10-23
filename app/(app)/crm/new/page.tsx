import { Card, CardBody, PageHeader } from '@/components/ui/card'
import { ContactFields } from '@/components/ops/contact-fields'
import { requirePageAccess } from '@/lib/auth/session'
import { ActionForm } from '../../inventory/forms'
import { saveContactAction } from '../actions'

export const dynamic = 'force-dynamic'

export default async function NewContactPage() {
  await requirePageAccess('crm:write')
  return (
    <>
      <PageHeader title="Add a contact" description="A customer, lead, supplier, partner, donor or volunteer. If the email or phone already belongs to someone, the form says whose it is, so nobody gets two records." />
      <Card>
        <CardBody>
          <ActionForm action={saveContactAction} hidden={{}} label="Add contact" busy="Saving…" tone="primary">
            <ContactFields />
          </ActionForm>
        </CardBody>
      </Card>
    </>
  )
}
