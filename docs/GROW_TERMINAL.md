# Shop card terminal (Grow)

A /shop sale pushes its balance to the shop's Grow terminal; Grow's server
update records the payment on the sale. Code: `lib/payments/grow-terminal.ts`
(pure), `lib/sales/terminal.ts` (service), `app/api/webhooks/grow/route.ts`,
`components/sales/terminal-charge.tsx`, migration `0007_terminal_charges.sql`.

## Flow (Grow: "Initiating a Transaction on a POS Terminal or Android Device")

1. Seller presses **חיוב במסופון** on the sale. We call `createPaymentProcess`
   with the terminal's dedicated `pageCode`, the device's `deviceKey`, the sum,
   `notifyUrl` = `/api/webhooks/grow?token=…` and `cField1` = our charge id.
   Grow returns a url. Nothing is recorded as paid.
2. Seller opens **שליחה למסופון** (that url) on the phone/computer running
   /shop, NOT on the terminal, and keeps it open. The GROW app on the terminal must
   already be open on its home screen (a Grow POS terminal: "מסופון סליקה").
3. Customer pays on the terminal. Grow sends a server update; we record a
   `card` payment of exactly what Grow says was charged (request id
   `grow:<transactionId>`, so a repeated update records once), mark the charge
   paid, write the customer's timeline, then call `approveTransaction`.
4. The sale page polls every 3 s while a charge waits, so the counter sees it.

The items were already sold (inventory + website stock) when the sale was
created; the terminal only collects money. No money figure is computed here:
the payment is an ordinary `cc_sale_payments` row, read by `saleMoney`.

## Rules

- One waiting charge per sale (10 min); cancel here is local only, cancel on
  the terminal too. A paid update for a cancelled or failed charge is still
  recorded: the card was charged.
- An update that names no charge of ours (the account-wide webhook carries the
  website's and gift cards' sales) is answered 200 and ignored.
- A failed `approveTransaction` is stored on the charge and shown on the sale;
  the payment stands.
- The shop's terminal runs the GROW app (Android flow, needs Grow's "Touch"
  service). It caps a physical card tap at ₪300; digital wallets are not
  capped. The sale page says so above ₪300; the seller can charge less than
  the balance and push the rest as a second charge.
- Live only: Grow has no sandbox for this flow. The first test is a real ₪1
  charge, refunded in Grow afterwards and recorded as a refund on the sale.

## Unverified until the first real charge

The page Grow sent describes the flow, not the payloads. The server-update
field names (`data[transactionId]`, `data[paymentSum]`, `data[statusCode]` = 2
for paid, `data[customFields][cField1]`, or the flat `transactionCode` /
`paymentSum` the account webhook sends) and the `approveTransaction` fields
follow Grow's Light Server API as used in gift_card_system and are parsed
tolerantly. Every update is stored raw on its charge (`raw`), so the first ₪1
charge shows exactly what Grow sends. The API base is overridable
(`GROW_API_URL`, `GROW_API_PATH`).
