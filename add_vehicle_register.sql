-- Run once in the Supabase SQL editor.
--
-- Vehicle Register / trip log (2026-08-27) — Thijs: "In the Ops app I want to
-- build a car register, where the guys keep track of the driven km's, who was
-- the driver, and what the purpose was... then make it possible that we can
-- add the driven km's for maintenance to job cards, this to make the
-- 'internal' invoicing even more specific with the vehicle/km cost to it."
--
-- DEMO COMPANY ONLY for now — gated behind companies.vehicle_register_enabled,
-- the same feature-flag pattern already used for Member Billing. Nothing
-- appears in any real lodge's Ops app until that flag is switched on.
--
-- Confirmed design (3 questions, all "Recommended"):
--   1. Cost per km is a rate held PER VEHICLE (fleet.cost_per_km) — a game
--      viewer and a staff bakkie don't cost the same, and a per-vehicle rate
--      stays predictable rather than swinging with fuel price.
--   2. Distance is entered as START and END odometer, not a km figure. Harder
--      to fudge, and it keeps each vehicle's current odometer live — which
--      makes the "service due by km" alerts the Fleet page already computes
--      actually accurate for the first time (they had no current reading to
--      compare against before).
--   3. Private trips are recorded as a category only. No money is attached
--      and nothing is charged to drivers.
--
-- Note on the existing fuel logs: diesel_issues/petrol_issues already capture
-- an odometer reading at refuel time. That is deliberately NOT merged into
-- this — a refuel is one moment, a trip is a span, and conflating them would
-- make both harder to reason about. They're independent records of the same
-- vehicle and can be cross-checked later if that's ever useful.
--
-- Safe to re-run.

-- 1. Feature flag + per-vehicle rate ---------------------------------------

alter table companies add column if not exists vehicle_register_enabled boolean not null default false;

alter table fleet add column if not exists cost_per_km numeric;

comment on column fleet.cost_per_km is
  'Rand per kilometre used to cost trips for internal billing. Null means this vehicle is not costed — its trips still record km, they just carry no value.';

-- 2. Trip purposes — editable list, not a hardcoded enum -------------------
--
-- Thijs asked for Game Drive / Private / Town Trip / Maintenance "and an
-- option to add categories to it", so these are rows rather than a check
-- constraint. is_maintenance is what makes a purpose able to attach to a job
-- card; it's a flag rather than a hardcoded name match so a company can call
-- it "Workshop Run" or add a second maintenance-type purpose later without
-- any code change.

create table if not exists vehicle_trip_purposes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  name text not null,
  is_maintenance boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create index if not exists idx_vehicle_trip_purposes_company on vehicle_trip_purposes (company_id);

alter table vehicle_trip_purposes enable row level security;

drop policy if exists "read_company_vehicle_trip_purposes" on vehicle_trip_purposes;
create policy "read_company_vehicle_trip_purposes" on vehicle_trip_purposes
  for select using (has_company_access(company_id));

-- Only admins curate the category list; anyone can log a trip against it.
drop policy if exists "admin_write_vehicle_trip_purposes" on vehicle_trip_purposes;
create policy "admin_write_vehicle_trip_purposes" on vehicle_trip_purposes
  for all using (
    is_platform_admin()
    or exists (select 1 from user_companies where user_id = auth.uid() and company_id = vehicle_trip_purposes.company_id and role = 'admin')
  ) with check (
    is_platform_admin()
    or exists (select 1 from user_companies where user_id = auth.uid() and company_id = vehicle_trip_purposes.company_id and role = 'admin')
  );

-- 3. The trip log ----------------------------------------------------------
--
-- km and trip_cost are GENERATED columns rather than values the app writes.
-- That means the distance can never disagree with the odometer readings it
-- came from, and the cost can never disagree with the rate that was in force
-- when the trip was saved — no drift, no recalculation bugs, and it's true
-- for rows written by the app, by a script, or by hand in the SQL editor.
--
-- cost_per_km is SNAPSHOT onto the trip, not read live from fleet. Changing a
-- vehicle's rate must not silently restate last quarter's internal invoices —
-- same reasoning as the labour rates snapshotted onto job invoices.

create table if not exists vehicle_trips (
  id uuid primary key,
  company_id uuid not null references companies(id),
  location_id text not null,
  -- TEXT, not uuid: fleet ids are the registration/label a person types on the
  -- Fleet page ("GD6 Martin"), not generated keys. maint_jobs.id below IS a
  -- uuid, so the two FKs genuinely differ in type.
  vehicle_id text not null references fleet(id) on delete cascade,
  purpose_id uuid references vehicle_trip_purposes(id) on delete set null,

  trip_date date not null,
  driver_name text not null,
  driver_employee_id uuid,          -- soft link to hr_employees, may be null
                                    -- (guests and contractors drive too)

  start_km numeric not null,
  -- Nullable on purpose: crew log the trip as they leave and close it off when
  -- they get back, which may be hours later and after the app has been shut.
  -- An open trip (end_km null) is a normal state. km and trip_cost below both
  -- evaluate to null while it's open, and the check constraint passes on null,
  -- so an open trip simply carries no distance or cost until it's closed.
  end_km numeric,
  km numeric generated always as (end_km - start_km) stored,

  -- Only set when the purpose is a maintenance one. on delete set null so
  -- deleting a job card never destroys the trip record itself.
  job_id uuid references maint_jobs(id) on delete set null,

  cost_per_km numeric,
  trip_cost numeric generated always as ((end_km - start_km) * coalesce(cost_per_km, 0)) stored,

  notes text,
  created_at timestamptz not null default now(),

  constraint vehicle_trips_km_forward check (end_km >= start_km)
);

create index if not exists idx_vehicle_trips_company on vehicle_trips (company_id);
create index if not exists idx_vehicle_trips_vehicle on vehicle_trips (vehicle_id);
create index if not exists idx_vehicle_trips_job on vehicle_trips (job_id);
create index if not exists idx_vehicle_trips_date on vehicle_trips (trip_date);

alter table vehicle_trips enable row level security;

-- Any staff member with company access can log and read trips — this is a
-- day-to-day operational record, not management-sensitive like salary data.
drop policy if exists "company_vehicle_trips" on vehicle_trips;
create policy "company_vehicle_trips" on vehicle_trips
  for all using (has_company_access(company_id))
  with check (has_company_access(company_id));

-- 4. Seed the four purposes Thijs named, for whichever companies have the
--    feature on. Re-running adds nothing (unique on company_id, name).
--    Idempotent, and safe to run again after enabling a new company.

insert into vehicle_trip_purposes (company_id, name, is_maintenance, sort_order)
select c.id, p.name, p.is_maintenance, p.sort_order
from companies c
cross join (values
  ('Game Drive', false, 1),
  ('Private',    false, 2),
  ('Town Trip',  false, 3),
  ('Maintenance', true, 4)
) as p(name, is_maintenance, sort_order)
where c.vehicle_register_enabled = true
on conflict (company_id, name) do nothing;

-- =========================================================================
-- TURN IT ON FOR DEMO
-- =========================================================================
-- Check the slug first, then run the update and re-run the seed above.
--
--   select id, name, slug from companies order by name;
--   update companies set vehicle_register_enabled = true where slug = 'demo';
--
-- Then re-run step 4's insert so Demo gets its four starting purposes.

-- =========================================================================
-- VERIFICATION
-- =========================================================================

select name, slug, vehicle_register_enabled from companies order by name;

select c.name as company, p.name as purpose, p.is_maintenance
from vehicle_trip_purposes p join companies c on c.id = p.company_id
order by c.name, p.sort_order;

select count(*) as trips from vehicle_trips;

-- REMINDER: vehicle_trip_purposes and vehicle_trips are NEW tables — switch
-- both on under Data API -> Exposed tables, or every read/write 404s.
