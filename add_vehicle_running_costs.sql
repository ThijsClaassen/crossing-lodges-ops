-- add_vehicle_running_costs.sql — the costs a vehicle carries that no app
-- had a transaction for (#488, 2026-09-27).
--
-- Thijs: "Vehicles, add other cost: trackers etc etc. GET THE FULL COSTING."
-- Decided 2026-09-27: include tracker, licence disk, roadworthy, radio
-- licence, tolls, fines, towing, cleaning, and depreciation (read from the
-- fixed asset register via fixed_assets.fleet_id — no new data). Tyres are
-- booked under repairs. Finance/lease instalments and service plans are
-- left out for now.
--
-- One row per cost: recurring (monthly / annual, from a start date, to an
-- optional end) or once (a dated amount). Adding a new kind of cost is a
-- row, not a migration — `kind` is free text with a picklist in the app.
--
-- Everything here feeds computeVehicleCosts() → cost/km → the trip running
-- rate → Maintenance internal billing. Safe to re-run.

create table if not exists vehicle_costs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  vehicle_id  text not null references fleet(id) on delete cascade,
  kind        text not null,                    -- tracker | licence_disk | roadworthy | radio_licence | tolls | fines | towing | cleaning | other
  description text,
  amount      numeric not null check (amount >= 0),
  period      text not null check (period in ('monthly', 'annual', 'once')),
  start_date  date not null,                    -- recurring: from when; once: the date it happened
  end_date    date,                             -- recurring only; null = still running
  notes       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  constraint vehicle_costs_dates check (end_date is null or end_date >= start_date)
);
create index if not exists vehicle_costs_vehicle_idx on vehicle_costs (company_id, vehicle_id);

alter table vehicle_costs enable row level security;
drop policy if exists "allow_company_vehicle_costs" on vehicle_costs;
create policy "allow_company_vehicle_costs" on vehicle_costs
  for all using (has_company_access(company_id)) with check (has_company_access(company_id));
grant select, insert, update, delete on vehicle_costs to authenticated;

-- The Ops app reads fixed_assets for the vehicles linked to it (fleet_id):
-- purchase date, cost, rate, useful life, disposal date. Row policy on
-- fixed_assets is already "read own company" (rewrite_finance_rls), so no
-- change there — this just confirms the columns the app relies on exist.
select column_name from information_schema.columns
 where table_name = 'fixed_assets'
   and column_name in ('fleet_id', 'purchase_date', 'cost_price', 'depreciation_rate', 'useful_life_years', 'disposal_date')
 order by 1;

-- ===========================================================================
-- THE MIGRATION ENDS HERE.
-- ===========================================================================
select 'vehicle_costs' as what, count(*) from vehicle_costs;
