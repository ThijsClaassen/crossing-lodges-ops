-- Run once in the Supabase SQL editor.
--
-- Monthly insurance premium per vehicle (2026-08-27) — Thijs: "I see we are
-- missing a real cost that we need to add per vehicle. Insurance cost, I want
-- to be able to fill in the monthly insurance premium per vehicle. And then
-- that also need to be taken into the calculation for cost per km."
--
-- This is a MANUAL field, unlike the rest of the running-cost calculation
-- which derives everything from logged transactions. That's not an oversight:
-- there is no insurance transaction anywhere in the system to read a premium
-- from, so it has to be entered. Fuel, parts and repairs stay derived.
--
-- How it feeds cost per km (see computeVehicleCosts in src/App.jsx):
--   * Lifetime view — premium x every month since the vehicle's FIRST logged
--     record, up to today. Insurance accrues whether the vehicle moves or
--     not, so a bakkie parked for three months still carries three months of
--     premium.
--   * Month view — premium x 1.
--   * Filtered to one lodge — the premium is split across lodges by share of
--     kilometres, since a premium belongs to the vehicle rather than to any
--     one lodge. The all-lodges view (which is what trip costing uses) always
--     comes to the full premium.
--
-- Applies to every company, not just Demo: this is a plain cost field, not
-- part of the Demo-only Vehicle Register trial. A vehicle with no premium
-- set simply contributes nothing, exactly as before.
--
-- Safe to re-run.

alter table fleet add column if not exists insurance_monthly numeric;

comment on column fleet.insurance_monthly is
  'Monthly insurance premium in rand for this vehicle. Manual — there is no insurance transaction to derive it from. Feeds the cost-per-km calculation on the Ops Cost Summary and the running rate used to cost maintenance trips. Null means not separately insured.';

-- =========================================================================
-- VERIFICATION
-- =========================================================================

select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'fleet' and column_name = 'insurance_monthly';

-- Nothing is set yet, which is expected — fill premiums in on the Fleet page.
select c.name as company, f.name as vehicle, f.category, f.insurance_monthly
from fleet f join companies c on c.id = f.company_id
order by c.name, f.name;
