-- Parts purchase log — 2026-08-12
--
-- Ops's Parts & Stock page had no way to log an ongoing restock of an
-- existing part — a part row was only ever created once (with a single
-- opening qty/cost and a single "purchase" qty/cost baked into that same
-- row), and the only action after that was Issue Part. This adds a proper
-- append-only purchase log, matching the same shape as
-- diesel_deliveries/petrol_purchases/repairs, including slip_id so a photo
-- can be attached the same way (see add_purchase_slips.sql, run first).
--
-- The existing parts.open_qty/open_cost/purchase_qty/purchase_cost columns
-- are left exactly as they are — they still represent the part's original
-- opening position when it was first added to the register. Everything
-- purchased after that now goes through this table instead, and
-- parts.closing_qty is incremented directly on each purchase (same pattern
-- already used for Issue Part, which decrements it directly).

create table if not exists parts_purchases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  location_id text not null,
  part_id uuid not null references parts(id) on delete cascade,
  date date not null,
  qty numeric not null,
  total_cost numeric not null default 0,
  supplier text,
  notes text,
  slip_id uuid references purchase_slips(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_parts_purchases_company on parts_purchases(company_id);
create index if not exists idx_parts_purchases_part on parts_purchases(part_id);

alter table parts_purchases enable row level security;

drop policy if exists "allow_company_parts_purchases" on parts_purchases;
create policy "allow_company_parts_purchases" on parts_purchases
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));
