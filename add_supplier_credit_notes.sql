-- Run once in the Supabase SQL editor.
--
-- New cross-app table for "Supplier Credit Notes" — when the wrong item was
-- bought and has to go back to the supplier. One shared table (same
-- app-tagged pattern as purchase_slips, which already spans
-- food/beverage/ops/maintenance/curio) rather than 5 separate per-app
-- tables, since a credit note is a financial record Finance Dashboard needs
-- to cross-check against supplier statements the same way it already does
-- for the 8 purchase-adjacent tables (see supplierRecon.js).
--
-- Stock effect is handled in each app's own code, NOT by this table:
--   - Food/Beverage/Maintenance/Curio: logging a credit note also inserts a
--     normal stock-reducing Issue with a new reason "Returned to Supplier"
--     (added to each app's own ISSUE_REASONS list in code) — reuses every
--     existing stock-count/variance/reorder calculation with zero changes.
--   - Ops (Parts & Stock): parts_issues has no reason column and requires a
--     vehicle_id (every part issue there is issued to a vehicle/equipment),
--     so it doesn't fit the same reuse. Ops instead decrements
--     parts.closing_qty directly, matching the pattern its own
--     logPurchase/issuePart already use.
--
-- Safe to re-run: "if not exists" throughout.

create table if not exists supplier_credit_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  app text not null check (app in ('food','beverage','ops','maintenance','curio')),
  location_id text not null,
  period text,                   -- 'YYYY-MM', only set by the 3 apps that
                                  -- browse stock by period (Food/Beverage/
                                  -- Curio) so their Credit Notes tab can
                                  -- filter the same way Purchases/Issues do;
                                  -- left null by Maintenance/Ops
  item_id uuid,                  -- soft link into that app's own item/part
                                  -- table (food_items/bev_items/maint_items/
                                  -- curio_items/parts) — no hard FK since
                                  -- this table spans 5 different item tables
  item_description text not null,  -- snapshotted at log time, since the
                                    -- 5 item tables don't share a schema
  issue_id uuid,                 -- soft link to the stock-reducing Issue row
                                  -- (food_issues/bev_issues/maint_issues/
                                  -- curio_issues) this credit note's own
                                  -- insert created, so deleting a mistaken
                                  -- credit note can also reverse the stock
                                  -- deduction it caused. Null for Ops, which
                                  -- decrements parts.closing_qty directly
                                  -- instead of writing an Issue row.
  qty numeric not null check (qty > 0),
  unit_cost numeric not null default 0,   -- excl VAT, per unit
  total_credit numeric not null,          -- excl VAT — qty * unit_cost by
                                           -- default, editable (matches how
                                           -- purchases already store cost
                                           -- excl VAT in Food/Bev/Curio;
                                           -- Maintenance/Ops don't split VAT
                                           -- today either, so this is
                                           -- entered as their own "total
                                           -- cost" figure already is)
  supplier text not null,
  reason text not null check (reason in ('wrong_item','damaged','short_delivery','overcharged','duplicate','other')),
  credit_note_number text,       -- the supplier's own reference — often not
                                  -- known yet when the return is logged, so
                                  -- nullable and editable later
  purchase_id uuid,              -- soft link back to the originating
                                  -- purchase row, optional (helps audit
                                  -- trail + prefill cost; loose since the
                                  -- purchase lives in 5 different tables)
  date date not null,
  notes text,
  slip_id uuid references purchase_slips(id),  -- reuses the same photo
                                                -- upload as purchases (proof
                                                -- of return / the credit
                                                -- note document itself)
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_supplier_credit_notes_company on supplier_credit_notes(company_id);
create index if not exists idx_supplier_credit_notes_app on supplier_credit_notes(app);
create index if not exists idx_supplier_credit_notes_date on supplier_credit_notes(date);
create index if not exists idx_supplier_credit_notes_supplier on supplier_credit_notes(supplier);

alter table supplier_credit_notes enable row level security;

drop policy if exists "allow_company_supplier_credit_notes" on supplier_credit_notes;
create policy "allow_company_supplier_credit_notes" on supplier_credit_notes
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

-- =========================================================================
-- VERIFICATION
-- =========================================================================

select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'supplier_credit_notes'
order by ordinal_position;
