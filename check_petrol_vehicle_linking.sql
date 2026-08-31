-- Read-only. Answers one question: are petrol issues unlinked because the guys
-- aren't filling it in, or because the app gave them nothing to pick?
--
-- CORRECTED 2026-08-31: an earlier version joined fleet to locations on
-- f.location_id. That column does not exist — `fleet` is COMPANY-WIDE. The app
-- fetches it with company_id only and never filters it by lodge, so every lodge
-- sees every vehicle. (`service_location_id` exists but means "where it gets
-- serviced", not "where it lives".) The practical consequence: if the petrol
-- dropdown is empty at Zebras, it is empty everywhere, because no vehicle in
-- the whole company is marked fuel = 'petrol'.

-- =========================================================================
-- 1 of 3 — WHAT COULD THEY EVEN PICK?
-- The Petrol Issue dropdown is fleet filtered to fuel = 'petrol'. Zero here
-- means staff literally cannot link a vehicle — the app's fault, not theirs.
-- =========================================================================
select
  coalesce(f.fuel, '(not set)')                     as fuel_type,
  count(*)                                          as vehicles,
  string_agg(f.name, ', ' order by f.name)          as which
from fleet f
join companies c on c.id = f.company_id
where c.name = 'Crossing Lodges'
group by coalesce(f.fuel, '(not set)')
order by vehicles desc;

-- Explicit verdict on the petrol case.
select
  count(*) filter (where f.fuel = 'petrol')                                as petrol_vehicles,
  case
    when count(*) filter (where f.fuel = 'petrol') = 0
      then 'NOTHING TO PICK — app''s fault. Set fuel = petrol on the Fleet page.'
    else 'Options exist, so the blanks are entry habit — see section 2.'
  end                                                                      as verdict
from fleet f
join companies c on c.id = f.company_id
where c.name = 'Crossing Lodges';

-- =========================================================================
-- 2 of 3 — HOW OFTEN IS IT ACTUALLY LEFT BLANK?
-- Petrol compared against diesel at the same lodge. If diesel is well linked
-- and petrol is not, the difference is the dropdown, not the habit — the two
-- forms are filled in by the same people on the same day.
-- =========================================================================
select
  'petrol' as fuel, pi.location_id as lodge,
  count(*) as issues,
  count(*) filter (where pi.vehicle_id is not null) as linked,
  count(*) filter (where pi.vehicle_id is null)     as unlinked,
  round(100.0 * count(*) filter (where pi.vehicle_id is null) / nullif(count(*), 0), 0) as pct_unlinked
from petrol_issues pi
join companies c on c.id = pi.company_id
where c.name = 'Crossing Lodges'
group by pi.location_id

union all

select
  'diesel', di.location_id,
  count(*),
  count(*) filter (where di.vehicle_id is not null),
  count(*) filter (where di.vehicle_id is null),
  round(100.0 * count(*) filter (where di.vehicle_id is null) / nullif(count(*), 0), 0)
from diesel_issues di
join companies c on c.id = di.company_id
where c.name = 'Crossing Lodges'
group by di.location_id
order by lodge, fuel;

-- =========================================================================
-- 3 of 3 — DANGLING LINKS
-- A vehicle_id pointing at a fleet row that no longer exists renders blank in
-- the app, which looks identical to never having been filled in. Rule it out
-- before concluding anything about how people are working.
-- =========================================================================
select
  pi.location_id as lodge, pi.date, pi.litres, pi.vehicle_id,
  'vehicle_id set but no matching fleet row' as problem
from petrol_issues pi
join companies c on c.id = pi.company_id
where c.name = 'Crossing Lodges'
  and pi.vehicle_id is not null
  and not exists (
    select 1 from fleet f
    where f.id = pi.vehicle_id and f.company_id = pi.company_id
  )
order by pi.date desc;
