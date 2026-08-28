-- Run once in the Supabase SQL editor. Demo company only.
--
-- Fix (2026-08-27): Demo's eight fleet rows were seeded with descriptive
-- categories — 'Game Drive Vehicle', 'Support Vehicle', 'Transfer Vehicle',
-- 'Utility', 'Grounds' — but the Ops app only recognises two: 'vehicle' and
-- 'equipment'. The Fleet page groups strictly on those two values, so every
-- Demo vehicle matched neither group and disappeared from the page, while
-- still showing up in every dropdown (those don't filter by category). Hence
-- "the dropdowns have vehicles but the Fleet tab is empty".
--
-- The app side is also being made tolerant in the same commit, so an
-- unrecognised category can never hide a row again. This file fixes the data
-- so Demo matches what a real company's fleet would look like.
--
-- Mapping: anything driven becomes 'vehicle'; the tractor becomes
-- 'equipment', since it's grounds machinery rather than transport. Change
-- that line if you'd rather see it under Vehicles.
--
-- Safe to re-run.

update fleet
set category = case
  when name = 'Tractor' then 'equipment'
  else 'vehicle'
end
where company_id = (select id from companies where slug = 'demo');

-- =========================================================================
-- VERIFICATION
-- =========================================================================
-- All eight should now read 'vehicle' or 'equipment', nothing else.

select name, category, fuel, cost_per_km
from fleet
where company_id = (select id from companies where slug = 'demo')
order by category, name;

-- Sanity check across every company: anything not in these two values would
-- be invisible on the Fleet page under the OLD grouping. Should return no
-- rows for Crossing Lodges too.
select c.name as company, f.name as vehicle, f.category
from fleet f join companies c on c.id = f.company_id
where f.category not in ('vehicle','equipment');
