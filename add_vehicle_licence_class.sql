-- add_vehicle_licence_class.sql — what licence a vehicle needs, and whether
-- the driver had it when the trip was logged (#485, 2026-09-27).
--
-- Thijs: "On vehicle list, what license is needed to drive a vehicle? At
-- vehicle log, when vehicle is selected, only drivers with the right
-- qualification can make the log / are being shown in the drop down list."
--
-- Decision (2026-09-27): an unqualified driver is shown GREYED WITH THE
-- REASON, not hidden. Hiding produces the "why isn't Piet in the list" call;
-- "Piet — licence expired 03 Mar 2026" answers it on the spot.
--
-- Historical logs: a trip stores a snapshot of whether the driver qualified
-- ON THAT DAY (driver_qualified). A licence expiring later never makes an
-- old trip retroactively invalid, and a trip logged with an expired licence
-- stays visibly so even after the licence is renewed.
--
-- Requires add_hr_qualifications.sql (HR app) to have been run first — that
-- is where hr_qualifications and drivers_for_vehicle() live. Same database.
-- Safe to re-run.

alter table fleet add column if not exists required_licence_class text;
alter table fleet add column if not exists requires_pdp boolean not null default false;
comment on column fleet.required_licence_class is
  'SA licence code needed to drive it (B, EB, C1, C, EC1, EC). Null = no requirement (equipment, or not set yet).';
comment on column fleet.requires_pdp is
  'True when carrying passengers for reward (game viewers, shuttles): the driver needs a professional driving permit too.';

alter table vehicle_trips add column if not exists driver_qualified boolean;
alter table vehicle_trips add column if not exists driver_licence_class text;
comment on column vehicle_trips.driver_qualified is
  'Snapshot when the trip was logged: did the driver hold the class (and PDP) the vehicle required, unexpired, on trip_date? Null = not a staff driver, or the vehicle had no requirement.';

-- ===========================================================================
-- THE MIGRATION ENDS HERE.
-- ===========================================================================
select column_name from information_schema.columns
 where table_name in ('fleet', 'vehicle_trips')
   and column_name in ('required_licence_class', 'requires_pdp', 'driver_qualified', 'driver_licence_class')
 order by 1;
select count(*) as drivers_for_vehicle_exists from pg_proc where proname = 'drivers_for_vehicle';
