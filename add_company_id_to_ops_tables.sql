-- Run once in the Supabase SQL editor.
--
-- OPS 3a of the multi-tenant rebuild.
--
-- Same Supabase project as Finance Dashboard/Food Stock/HR-Linen (confirmed
-- 2026-08-08), so companies/user_companies/platform_admins/
-- has_company_access()/default_crossing_lodges_company_id() ALL ALREADY
-- EXIST — nothing from Phase 1 needs to be recreated.
--
-- Adds company_id to Ops's 11 own tables: fleet (company-wide, no location
-- split), diesel_deliveries, diesel_issues, diesel_dips, diesel_opening,
-- petrol_purchases, petrol_issues, petrol_opening, parts, parts_issues,
-- repairs (these 10 are all per-location, ZC/EC/SC).
--
-- Two tables Ops touches but does NOT own are deliberately left alone:
--   - app_access: the old shared staff/admin password table. Not Ops-
--     specific (Finance Dashboard used to read the same table pre-
--     migration) — still needed by whichever sibling apps haven't shipped
--     real auth yet. 3b just stops Ops from reading it, same as
--     food_access/hr_access.
--   - maint_jobs / maint_job_materials: owned by the separate Maintenance
--     app (not yet migrated — confirmed with Thijs 2026-08-08 this is a
--     real 6th app in the suite, not in-scope here). Ops's
--     syncServiceJobs() writes a job card into maint_jobs when a self-
--     serviced vehicle is due for service — left untouched for now, same
--     deferred-gap treatment as Company Pulse's cross-app reads. Revisit
--     once Maintenance gets its own 3a and maint_jobs actually has a
--     company_id column to write.
--
-- Also fixes a real bug this migration would otherwise introduce:
-- diesel_opening and petrol_opening are upserted with onConflict targeting
-- location_id ALONE. Once a second company can also have a location coded
-- "ZC", that upsert would silently overwrite the wrong company's opening
-- balance. Adds a compound unique constraint on (location_id, company_id)
-- and drops the old single-column one — the app-side onConflict target
-- changes to match in 3b.
--
-- Drops the hardcoded `check (location_id in ('ZC','EC','SC'))` constraint
-- on the 10 location-scoped tables (if present) — same reasoning/decision
-- already made for Food Stock and HR/Linen: don't block a future company
-- from using its own property codes.
--
-- Safe to re-run: every statement uses "if not exists" / "if exists", and
-- every backfill only touches rows where company_id is still null.

-- 1. Add company_id (defaulted from the start) to all 11 tables ------------

alter table fleet add column if not exists company_id uuid references companies(id)
  default default_crossing_lodges_company_id();
alter table diesel_deliveries add column if not exists company_id uuid references companies(id)
  default default_crossing_lodges_company_id();
alter table diesel_issues add column if not exists company_id uuid references companies(id)
  default default_crossing_lodges_company_id();
alter table diesel_dips add column if not exists company_id uuid references companies(id)
  default default_crossing_lodges_company_id();
alter table diesel_opening add column if not exists company_id uuid references companies(id)
  default default_crossing_lodges_company_id();
alter table petrol_purchases add column if not exists company_id uuid references companies(id)
  default default_crossing_lodges_company_id();
alter table petrol_issues add column if not exists company_id uuid references companies(id)
  default default_crossing_lodges_company_id();
alter table petrol_opening add column if not exists company_id uuid references companies(id)
  default default_crossing_lodges_company_id();
alter table parts add column if not exists company_id uuid references companies(id)
  default default_crossing_lodges_company_id();
alter table parts_issues add column if not exists company_id uuid references companies(id)
  default default_crossing_lodges_company_id();
alter table repairs add column if not exists company_id uuid references companies(id)
  default default_crossing_lodges_company_id();

-- 2. Backfill every existing row to Crossing Lodges ------------------------

update fleet set company_id = (select id from companies where slug = 'crossing-lodges') where company_id is null;
update diesel_deliveries set company_id = (select id from companies where slug = 'crossing-lodges') where company_id is null;
update diesel_issues set company_id = (select id from companies where slug = 'crossing-lodges') where company_id is null;
update diesel_dips set company_id = (select id from companies where slug = 'crossing-lodges') where company_id is null;
update diesel_opening set company_id = (select id from companies where slug = 'crossing-lodges') where company_id is null;
update petrol_purchases set company_id = (select id from companies where slug = 'crossing-lodges') where company_id is null;
update petrol_issues set company_id = (select id from companies where slug = 'crossing-lodges') where company_id is null;
update petrol_opening set company_id = (select id from companies where slug = 'crossing-lodges') where company_id is null;
update parts set company_id = (select id from companies where slug = 'crossing-lodges') where company_id is null;
update parts_issues set company_id = (select id from companies where slug = 'crossing-lodges') where company_id is null;
update repairs set company_id = (select id from companies where slug = 'crossing-lodges') where company_id is null;

-- 3. Lock it down -------------------------------------------------------------

alter table fleet alter column company_id set not null;
alter table diesel_deliveries alter column company_id set not null;
alter table diesel_issues alter column company_id set not null;
alter table diesel_dips alter column company_id set not null;
alter table diesel_opening alter column company_id set not null;
alter table petrol_purchases alter column company_id set not null;
alter table petrol_issues alter column company_id set not null;
alter table petrol_opening alter column company_id set not null;
alter table parts alter column company_id set not null;
alter table parts_issues alter column company_id set not null;
alter table repairs alter column company_id set not null;

-- 4. Indexes --------------------------------------------------------------------

create index if not exists idx_fleet_company on fleet (company_id);
create index if not exists idx_diesel_deliveries_company on diesel_deliveries (company_id);
create index if not exists idx_diesel_issues_company on diesel_issues (company_id);
create index if not exists idx_diesel_dips_company on diesel_dips (company_id);
create index if not exists idx_diesel_opening_company on diesel_opening (company_id);
create index if not exists idx_petrol_purchases_company on petrol_purchases (company_id);
create index if not exists idx_petrol_issues_company on petrol_issues (company_id);
create index if not exists idx_petrol_opening_company on petrol_opening (company_id);
create index if not exists idx_parts_company on parts (company_id);
create index if not exists idx_parts_issues_company on parts_issues (company_id);
create index if not exists idx_repairs_company on repairs (company_id);

-- 5. Drop the hardcoded ZC/EC/SC location check on the 10 tables that have one

alter table diesel_deliveries drop constraint if exists diesel_deliveries_location_id_check;
alter table diesel_issues drop constraint if exists diesel_issues_location_id_check;
alter table diesel_dips drop constraint if exists diesel_dips_location_id_check;
alter table diesel_opening drop constraint if exists diesel_opening_location_id_check;
alter table petrol_purchases drop constraint if exists petrol_purchases_location_id_check;
alter table petrol_issues drop constraint if exists petrol_issues_location_id_check;
alter table petrol_opening drop constraint if exists petrol_opening_location_id_check;
alter table parts drop constraint if exists parts_location_id_check;
alter table parts_issues drop constraint if exists parts_issues_location_id_check;
alter table repairs drop constraint if exists repairs_location_id_check;

-- 6. Fix diesel_opening / petrol_opening's upsert-conflict target -----------
-- Was unique on location_id alone (matches the app's old onConflict="location_id").
-- Once a second company can also use "ZC" etc, that's a cross-company collision
-- waiting to happen. Drop the single-column uniqueness, add a compound one.

alter table diesel_opening drop constraint if exists diesel_opening_location_id_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'diesel_opening_location_company_key') then
    alter table diesel_opening add constraint diesel_opening_location_company_key unique (location_id, company_id);
  end if;
end $$;

alter table petrol_opening drop constraint if exists petrol_opening_location_id_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'petrol_opening_location_company_key') then
    alter table petrol_opening add constraint petrol_opening_location_company_key unique (location_id, company_id);
  end if;
end $$;

-- 7. Fix above: location_id was actually the PRIMARY KEY, not a plain unique
-- constraint named "..._location_id_key" — so step 6 silently dropped nothing
-- and the real single-column primary key was still blocking a second company
-- from ever using "ZC"/"EC"/"SC" (hit 2026-08-09 seeding Demo's diesel_opening).
-- Replace the single-column pkey with a compound one; the separate unique
-- constraint from step 6 becomes redundant once the pkey covers the same
-- columns, so drop it too.

alter table diesel_opening drop constraint if exists diesel_opening_pkey;
alter table diesel_opening drop constraint if exists diesel_opening_location_company_key;
alter table diesel_opening add constraint diesel_opening_pkey primary key (location_id, company_id);

alter table petrol_opening drop constraint if exists petrol_opening_pkey;
alter table petrol_opening drop constraint if exists petrol_opening_location_company_key;
alter table petrol_opening add constraint petrol_opening_pkey primary key (location_id, company_id);

-- =========================================================================
-- VERIFICATION — run this and check "total" equals "with_company" on every
-- row, and that the two compound unique constraints above show up.
-- =========================================================================

select 'fleet' as table_name, count(*) as total, count(company_id) as with_company from fleet
union all select 'diesel_deliveries', count(*), count(company_id) from diesel_deliveries
union all select 'diesel_issues', count(*), count(company_id) from diesel_issues
union all select 'diesel_dips', count(*), count(company_id) from diesel_dips
union all select 'diesel_opening', count(*), count(company_id) from diesel_opening
union all select 'petrol_purchases', count(*), count(company_id) from petrol_purchases
union all select 'petrol_issues', count(*), count(company_id) from petrol_issues
union all select 'petrol_opening', count(*), count(company_id) from petrol_opening
union all select 'parts', count(*), count(company_id) from parts
union all select 'parts_issues', count(*), count(company_id) from parts_issues
union all select 'repairs', count(*), count(company_id) from repairs
order by table_name;

-- Confirm the compound unique constraints landed:
--   select conname, conrelid::regclass from pg_constraint
--   where conname in ('diesel_opening_location_company_key','petrol_opening_location_company_key');
