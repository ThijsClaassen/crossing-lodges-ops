-- Purchase slip storage — 2026-08-12
--
-- Shared schema (same Supabase project as every other app) — run this ONCE,
-- from any one of the 6 apps' SQL editors, not once per app.
--
-- What this adds:
--   1. A private Storage bucket ("purchase-slips") to hold the actual photo
--      of every purchase slip/invoice, kept for South Africa's 7-year
--      financial record retention requirement (Companies Act s24 — the
--      stricter of the two retention rules that apply here, the Tax
--      Administration/VAT Act's own rule is 5 years).
--   2. purchase_slips — one row per uploaded photo. Deliberately a SEPARATE
--      record rather than an image column on each purchase row, because one
--      photographed slip often covers several purchase-table rows (e.g. a
--      food delivery note with 8 line items, or a repair invoice that's a
--      single row) — several rows can point back to the same slip_id.
--   3. A nullable slip_id column on every existing purchase-type table that
--      can be linked to one, in every app that has purchases:
--        food_purchases, bev_purchases       (Food / Beverage — schema only
--                                              this pass, no UI change yet)
--        maint_purchases                     (Maintenance)
--        diesel_deliveries, petrol_purchases, repairs   (Ops)
--      Parts is deliberately NOT included — a "parts purchase" there is an
--      edit to an existing item's stock/cost fields on the item register
--      row itself, not a discrete purchase event, so a single slip_id
--      wouldn't mean anything once that item is restocked again.
--
-- Requires has_company_access(uuid) to already exist (it does — added in
-- the multi-tenant rebuild, used by every other RLS policy in this project).

-- ---------------------------------------------------------------------------
-- 1. Storage bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('purchase-slips', 'purchase-slips', false, 8388608, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

-- Path convention every app's upload helper follows:
--   {company_id}/{app}/{uuid}.jpg
-- storage.foldername(name) splits the object path into an array, so
-- segment [1] is always the company_id folder — that's what these policies
-- check against, same has_company_access() every other table's RLS uses.
drop policy if exists "company members read own slips" on storage.objects;
create policy "company members read own slips" on storage.objects
  for select using (
    bucket_id = 'purchase-slips'
    and has_company_access((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "company members upload slips" on storage.objects;
create policy "company members upload slips" on storage.objects
  for insert with check (
    bucket_id = 'purchase-slips'
    and has_company_access((storage.foldername(name))[1]::uuid)
  );

-- Deliberately no UPDATE policy — a slip photo is the compliance record;
-- once uploaded it should never be silently replaced. DELETE is admin-only,
-- for the rare "wrong file uploaded" correction, not routine use.
drop policy if exists "admin delete slips" on storage.objects;
create policy "admin delete slips" on storage.objects
  for delete using (
    bucket_id = 'purchase-slips'
    and (is_platform_admin() or has_company_role((storage.foldername(name))[1]::uuid, 'admin'))
  );

-- ---------------------------------------------------------------------------
-- 2. purchase_slips
-- ---------------------------------------------------------------------------
create table if not exists purchase_slips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  app text not null check (app in ('food','beverage','ops','maintenance')),
  location_id text,
  storage_path text not null,
  supplier_guess text,
  date_guess date,
  slip_total_guess numeric,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_purchase_slips_company on purchase_slips(company_id);

alter table purchase_slips enable row level security;

drop policy if exists "company members read purchase_slips" on purchase_slips;
create policy "company members read purchase_slips" on purchase_slips
  for select using (has_company_access(company_id));

drop policy if exists "company members insert purchase_slips" on purchase_slips;
create policy "company members insert purchase_slips" on purchase_slips
  for insert with check (has_company_access(company_id));

-- No UPDATE policy on purpose — same "compliance record, don't quietly
-- edit it" reasoning as the storage object itself. Admin can delete a
-- mistaken upload (its storage object gets orphaned unless also deleted via
-- the storage policy above — the app's admin delete flow does both).
drop policy if exists "admin delete purchase_slips" on purchase_slips;
create policy "admin delete purchase_slips" on purchase_slips
  for delete using (is_platform_admin() or has_company_role(company_id, 'admin'));

-- ---------------------------------------------------------------------------
-- 3. slip_id link columns
-- ---------------------------------------------------------------------------
alter table food_purchases    add column if not exists slip_id uuid references purchase_slips(id);
alter table bev_purchases     add column if not exists slip_id uuid references purchase_slips(id);
alter table maint_purchases   add column if not exists slip_id uuid references purchase_slips(id);
alter table diesel_deliveries add column if not exists slip_id uuid references purchase_slips(id);
alter table petrol_purchases  add column if not exists slip_id uuid references purchase_slips(id);
alter table repairs           add column if not exists slip_id uuid references purchase_slips(id);
