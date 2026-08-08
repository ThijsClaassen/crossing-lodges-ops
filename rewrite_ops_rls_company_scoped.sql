-- Run once in the Supabase SQL editor.
--
-- OPS 3c of the multi-tenant rebuild.
--
-- Replaces whatever permissive RLS policy currently exists on Ops's 11 own
-- tables with one requiring has_company_access(company_id) — same pattern
-- as Finance Dashboard/Food Stock/HR-Linen's 2c/3c.
--
-- Unlike those three apps, this repo has no committed schema.sql, so the
-- exact existing policy name(s) on each table aren't known ahead of time.
-- Rather than guess, each block below dynamically drops EVERY existing
-- policy on that table (whatever it's called) before creating the new
-- company-scoped one — safer than a hardcoded "drop policy if exists
-- <guessed name>" and still fully re-runnable.
--
-- app_access and maint_jobs/maint_job_materials are deliberately NOT
-- touched here — not Ops-owned (see add_company_id_to_ops_tables.sql for
-- the full reasoning).

do $$
declare
  pol record;
  tbl text;
begin
  foreach tbl in array array[
    'fleet', 'diesel_deliveries', 'diesel_issues', 'diesel_dips', 'diesel_opening',
    'petrol_purchases', 'petrol_issues', 'petrol_opening', 'parts', 'parts_issues', 'repairs'
  ]
  loop
    for pol in select policyname from pg_policies where tablename = tbl loop
      execute format('drop policy if exists %I on %I', pol.policyname, tbl);
    end loop;
  end loop;
end $$;

create policy "allow_company_fleet" on fleet
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

create policy "allow_company_diesel_deliveries" on diesel_deliveries
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

create policy "allow_company_diesel_issues" on diesel_issues
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

create policy "allow_company_diesel_dips" on diesel_dips
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

create policy "allow_company_diesel_opening" on diesel_opening
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

create policy "allow_company_petrol_purchases" on petrol_purchases
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

create policy "allow_company_petrol_issues" on petrol_issues
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

create policy "allow_company_petrol_opening" on petrol_opening
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

create policy "allow_company_parts" on parts
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

create policy "allow_company_parts_issues" on parts_issues
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

create policy "allow_company_repairs" on repairs
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));

-- Make sure RLS is actually turned on for all 11 (should already be, but
-- belt-and-braces — a policy with no RLS enabled is silently a no-op).
alter table fleet enable row level security;
alter table diesel_deliveries enable row level security;
alter table diesel_issues enable row level security;
alter table diesel_dips enable row level security;
alter table diesel_opening enable row level security;
alter table petrol_purchases enable row level security;
alter table petrol_issues enable row level security;
alter table petrol_opening enable row level security;
alter table parts enable row level security;
alter table parts_issues enable row level security;
alter table repairs enable row level security;

-- =========================================================================
-- VERIFICATION — each of the 11 tables should show exactly one policy,
-- named allow_company_<table>, reading has_company_access(company_id).
-- =========================================================================

select tablename, policyname, cmd, qual, with_check
from pg_policies
where tablename in (
  'fleet', 'diesel_deliveries', 'diesel_issues', 'diesel_dips', 'diesel_opening',
  'petrol_purchases', 'petrol_issues', 'petrol_opening', 'parts', 'parts_issues', 'repairs'
)
order by tablename;
