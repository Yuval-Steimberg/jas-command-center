import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { SourceProblem } from '@/components/ui/source-state'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getGiftCard } from '@/lib/integrations/gift-cards/adapter'
import { formatAgorot } from '@/lib/money'
import { formatDateTime } from '@/lib/format'
import { EditRecipientForm, ResendCardForm } from '../forms'

export const dynamic = 'force-dynamic'

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="contents">
    <dt className="text-muted">{k}</dt>
    <dd className="min-w-0 break-words">{v ?? '—'}</dd>
  </div>
)

export default async function GiftCardPage({ params }: { params: { id: string } }) {
  await requirePageAccess('gift_cards:read')
  if (!z.string().uuid().safeParse(params.id).success) notFound()
  const s = (await getSession())!
  const pii = can(s.user.role, 'gift_cards:read_pii', s.overrides)
  const operate = can(s.user.role, 'gift_cards:operate', s.overrides)
  const r = await getGiftCard(params.id)
  if (r === null) notFound()
  if (r.state !== 'ok') {
    return (
      <>
        <PageHeader title="Gift card" />
        <SourceProblem result={r} what="This card" />
      </>
    )
  }
  const { card, payment, delivery, ledger, redemptions, audit } = r.data
  const hidden = <span className="text-muted">hidden for your role</span>

  return (
    <>
      <PageHeader
        title={`Gift card ${card.maskedCode}`}
        description="Read live from the Gift Card System. The full code is never sent here; the recipient's email and the gift card admin have it."
        actions={<Link href="/gift-cards" className="text-sm text-muted underline-offset-2 hover:underline">All cards</Link>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader title="Card" />
            <CardBody>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <Row k="Status" v={card.status.replace(/_/g, ' ')} />
                <Row k="Value" v={<span className="num">{formatAgorot(card.initialAmountMinor)}</span>} />
                <Row k="Balance" v={<span className="num">{formatAgorot(card.balanceMinor)}</span>} />
                <Row k="Issued" v={card.issuedAt ? formatDateTime(card.issuedAt) : 'not activated'} />
                <Row k="Expires" v={card.expiresAt ? formatDateTime(card.expiresAt) : 'no expiry'} />
                <Row k="Scheduled delivery" v={card.scheduledDeliveryAt ? formatDateTime(card.scheduledDeliveryAt) : 'immediate'} />
                <Row k="Recipient" v={pii ? <span dir="auto">{card.recipientName} · <span dir="ltr">{card.recipientEmail}</span>{card.recipientPhone ? <> · <span dir="ltr">{card.recipientPhone}</span></> : null}</span> : hidden} />
                <Row k="Buyer" v={pii ? <span dir="auto">{card.buyerName ?? 'anonymous'} · <span dir="ltr">{card.buyerEmail}</span>{card.buyerPhone ? <> · <span dir="ltr">{card.buyerPhone}</span></> : null}</span> : hidden} />
                <Row k="Payment" v={payment ? `${payment.provider} · ${payment.status} · ${formatAgorot(payment.amountMinor)} · ${formatDateTime(payment.createdAt)}` : 'none recorded'} />
                {card.supersededByCardId ? <Row k="Reissued as" v={<Link className="underline" href={`/gift-cards/${card.supersededByCardId}`}>replacement card</Link>} /> : null}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Delivery" meta={`${delivery.length} job(s)`} />
            <CardBody>
              {delivery.length ? (
                <ul className="divide-y divide-line/70 text-sm">
                  {delivery.map((d) => (
                    <li key={d.id} className="py-2">
                      <div className="flex flex-wrap justify-between gap-2"><span>{d.channel} · <strong className={d.status === 'sent' || d.status === 'delivered' ? 'text-ok' : d.status === 'failed' || d.status === 'cancelled' ? 'text-bad' : ''}>{d.status}</strong> · {d.attempts} attempt(s)</span><span className="text-meta text-muted">{formatDateTime(d.updatedAt)}</span></div>
                      {d.lastError ? <div className="break-words text-xs text-bad">{d.lastError}</div> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No delivery job: the card has not been sent.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Ledger and redemptions" />
            <CardBody>
              <ul className="divide-y divide-line/70 text-sm">
                {ledger.map((l) => (
                  <li key={l.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>{l.type.replace(/_/g, ' ')}{l.reason ? <span className="text-muted"> · {l.reason}</span> : null}</span>
                    <span className="num">{l.amountMinor > 0 ? '+' : ''}{formatAgorot(l.amountMinor)} → {formatAgorot(l.balanceAfterMinor)} <span className="text-meta text-muted">{formatDateTime(l.createdAt)}</span></span>
                  </li>
                ))}
              </ul>
              {redemptions.some((x) => x.reversed) ? <p className="mt-2 text-xs text-muted">{redemptions.filter((x) => x.reversed).length} redemption(s) were reversed.</p> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Gift card system audit" meta="Actions taken on this card, including from here" />
            <CardBody>
              {audit.length ? (
                <ul className="divide-y divide-line/70 text-sm">
                  {audit.map((a, i) => (
                    <li key={i} className="py-2"><div className="flex flex-wrap justify-between gap-2"><span>{a.action}</span><span className="text-meta text-muted">{formatDateTime(a.createdAt)}</span></div>{a.reason ? <div dir="auto" className="text-xs text-muted">{a.reason}</div> : null}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No actions recorded.</p>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          {operate ? (
            <>
              <Card>
                <CardHeader title="Resend" meta="Same address" />
                <CardBody><ResendCardForm id={card.id} label={card.maskedCode} /></CardBody>
              </Card>
              {pii ? (
                <Card>
                  <CardHeader title="Change recipient" meta="When an address bounced or was wrong" />
                  <CardBody><EditRecipientForm id={card.id} label={card.maskedCode} current={{ name: card.recipientName, email: card.recipientEmail, phone: card.recipientPhone }} /></CardBody>
                </Card>
              ) : null}
            </>
          ) : (
            <Card><CardBody><p className="text-sm text-muted">Your role can view this card but not change it.</p></CardBody></Card>
          )}
          <Card>
            <CardBody>
              <p className="text-xs text-muted">Refund, suspend, reissue, balance adjustment and mark-paid stay in the Gift Card System admin for now: they move money and need its owner-only checks.</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
