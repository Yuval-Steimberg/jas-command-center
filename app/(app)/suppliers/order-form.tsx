import { input } from '../website/forms'
import { ActionForm, Field } from '../inventory/forms'
import { OrderLines } from '@/components/ops/order-lines'
import type { PurchaseOrder } from '@/lib/suppliers/model'
import { saveOrderAction } from './actions'

/** New order and edit order share one form; the server re-validates every line. */
export function OrderForm({ po, suppliers, supplierId, showCost, categories }: {
  po?: PurchaseOrder
  suppliers: { id: string; label: string }[]
  supplierId?: string
  showCost: boolean
  categories: string[]
}) {
  return (
    <ActionForm action={saveOrderAction} hidden={po ? { id: po.id, version: po.version } : {}} label={po ? 'Save order' : 'Create order'} busy="Saving…" tone="primary" className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supplier">
          <select name="supplierId" required defaultValue={po?.supplierId ?? supplierId ?? ''} className={input}>
            <option value="" disabled>Choose a supplier</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Expected by" hint="Optional. An order past this date shows as late."><input name="expectedAt" type="date" defaultValue={po?.expectedAt ?? ''} dir="ltr" className={input} /></Field>
      </div>
      <OrderLines
        showCost={showCost}
        categories={categories}
        initial={po?.lines.map((l) => ({ description: l.description, quantity: l.quantity, category: l.category, cost: l.unitCostMinor == null ? '' : String(l.unitCostMinor / 100) }))}
      />
      <Field label="Note for the supplier" hint="Included in the WhatsApp / email text"><textarea name="note" defaultValue={po?.note ?? ''} dir="auto" maxLength={1000} rows={2} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" /></Field>
    </ActionForm>
  )
}
