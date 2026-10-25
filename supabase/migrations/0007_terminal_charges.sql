-- 0007: the shop's Grow card terminal (lib/payments/grow-terminal.ts, lib/sales/terminal.ts).
-- One row per amount pushed to the terminal from a sale. The money itself is
-- still a cc_sale_payments row (method 'card'), written when Grow's server
-- update says the card was charged; its request id is 'grow:<transactionId>',
-- so Grow sending the same update twice records one payment.
-- Idempotent: safe to run again.

create table if not exists cc_terminal_charges (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references cc_sales(id) on delete restrict,
  amount_minor     integer not null check (amount_minor > 0),
  device           text not null,                    -- the device's NAME, never its key
  status           text not null default 'sent' check (status in ('sent','paid','failed','cancelled')),
  url              text,
  process_id       text,
  transaction_id   text unique,
  asmachta         text,
  card_suffix      text,
  paid_minor       integer,
  payment_id       uuid references cc_sale_payments(id) on delete set null,
  approved_at      timestamptz,
  approve_error    text,
  error            text,
  raw              jsonb,
  request_id       text not null unique,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists cc_terminal_charges_sale on cc_terminal_charges (sale_id, created_at desc);
create index if not exists cc_terminal_charges_process on cc_terminal_charges (process_id) where process_id is not null;

alter table cc_terminal_charges enable row level security;
revoke all on cc_terminal_charges from anon, authenticated;
