-- Fix the Demo fleet: human registrations instead of UUIDs, and the app's
-- own DD/MM/YYYY date format instead of ISO.
--
-- Background. fleet.id is a natural key — it is the registration or label a
-- person types on the Fleet page ("GD6 Martin"), which is why the Fleet table
-- header reads "ID / Reg" and why vehicle_trips.vehicle_id is text. Crossing
-- Lodges' own fleet is correct, because it was entered through the form. The
-- Demo company was seeded by script with generated UUIDs, so every demo
-- vehicle card showed a2c7...-style keys under the vehicle name.
--
-- The dates in the same seed were written as ISO ('2026-10-06') into columns
-- the app stores as DD/MM/YYYY text. The app now reads both formats, so this
-- half is no longer load-bearing — but leaving two formats in one column
-- guarantees someone trips over it later.
--
-- SCOPED TO THE DEMO COMPANY ONLY. Every statement below carries an explicit
-- company_id filter; Crossing Lodges' live fleet is not touched.
--
-- Safe to re-run: the id mapping matches on the old UUID, so a second run
-- finds nothing to change.

begin;

-- ── 1. Let the one real FK follow an id change ──────────────────────────────
-- vehicle_trips.vehicle_id references fleet(id) with ON DELETE CASCADE but no
-- ON UPDATE rule, so renaming a vehicle would be blocked outright. The app
-- currently forbids editing an id after creation, so this changes no user-
-- facing behaviour today — it just makes a natural primary key behave like
-- one, and lets the update below cascade instead of needing a delete/recreate
-- dance that would risk taking trip history with it.
alter table vehicle_trips
  drop constraint if exists vehicle_trips_vehicle_id_fkey;
alter table vehicle_trips
  add constraint vehicle_trips_vehicle_id_fkey
  foreign key (vehicle_id) references fleet(id)
  on delete cascade on update cascade;

-- ── 2. The mapping ──────────────────────────────────────────────────────────
create temporary table demo_fleet_id_map (old_id text primary key, new_id text not null) on commit drop;

insert into demo_fleet_id_map (old_id, new_id) values
  ('a67ce8a3-4668-411b-a907-78bf86ff3905', 'BCJ 418 L'),    -- Land Cruiser 1
  ('a5de9e3d-5eef-4f2b-8651-b19125bd4f80', 'BCK 902 L'),    -- Land Cruiser 2
  ('dd4b16c3-1809-482e-bbf1-9a7eadaf2131', 'BDF 275 L'),    -- Hilux Support
  ('5c49c6a1-8a03-4980-9d27-57467395b236', 'BCR 731 L'),    -- Quantum Shuttle
  ('1c20436d-ea22-4f7c-968b-59e9df478308', 'CART 01'),      -- Golf Cart 1  (not road registered)
  ('704566be-d5bb-47cd-b8cc-f438e7f61338', 'CART 02'),      -- Golf Cart 2  (not road registered)
  ('e3172c3a-4a9d-4d92-a25f-35925e620912', 'TRACTOR 01'),   -- Tractor      (not road registered)
  ('d728c8c4-5723-40f2-a4e0-282de133813d', 'BDL 664 L');    -- Generator Bakkie

-- ── 3. Repoint the children that have no FK ─────────────────────────────────
-- These must run BEFORE the fleet update: without an FK there is nothing to
-- cascade for them, and once fleet.id has changed the old value is gone and
-- the join can no longer be made. vehicle_trips is deliberately absent — the
-- constraint added in step 1 handles it.
update diesel_issues c set vehicle_id = m.new_id
  from demo_fleet_id_map m
 where c.vehicle_id = m.old_id
   and c.company_id = (select id from companies where slug = 'demo');

update petrol_issues c set vehicle_id = m.new_id
  from demo_fleet_id_map m
 where c.vehicle_id = m.old_id
   and c.company_id = (select id from companies where slug = 'demo');

update parts_issues c set vehicle_id = m.new_id
  from demo_fleet_id_map m
 where c.vehicle_id = m.old_id
   and c.company_id = (select id from companies where slug = 'demo');

update repairs c set vehicle_id = m.new_id
  from demo_fleet_id_map m
 where c.vehicle_id = m.old_id
   and c.company_id = (select id from companies where slug = 'demo');

-- maint_jobs belongs to the Maintenance app, but Ops writes vehicle service
-- jobs into it for self-serviced vehicles, so demo rows may reference a
-- fleet id even though the Maintenance seed itself never did.
update maint_jobs c set vehicle_id = m.new_id
  from demo_fleet_id_map m
 where c.vehicle_id = m.old_id
   and c.company_id = (select id from companies where slug = 'demo');

-- ── 4. The fleet itself (vehicle_trips cascades from here) ──────────────────
update fleet f set id = m.new_id
  from demo_fleet_id_map m
 where f.id = m.old_id
   and f.company_id = (select id from companies where slug = 'demo');

-- ── 5. Dates: ISO -> DD/MM/YYYY ─────────────────────────────────────────────
-- Only touches values that are unambiguously ISO. Anything already in the
-- app's own format fails the regex and is left alone, which is what makes
-- this re-runnable.
update fleet
   set license_expiry = to_char(to_date(license_expiry, 'YYYY-MM-DD'), 'DD/MM/YYYY')
 where company_id = (select id from companies where slug = 'demo')
   and license_expiry ~ '^\d{4}-\d{2}-\d{2}$';

update fleet
   set last_service_date = to_char(to_date(last_service_date, 'YYYY-MM-DD'), 'DD/MM/YYYY')
 where company_id = (select id from companies where slug = 'demo')
   and last_service_date ~ '^\d{4}-\d{2}-\d{2}$';

commit;

-- ── Check ───────────────────────────────────────────────────────────────────
-- Expect 8 rows, readable ids, dates as DD/MM/YYYY, and no orphaned children.
select id, name, license_expiry, last_service_date
  from fleet
 where company_id = (select id from companies where slug = 'demo')
 order by name;

select 'orphaned issue/repair rows' as check, count(*) as should_be_zero
  from (
    select vehicle_id, company_id from diesel_issues
    union all select vehicle_id, company_id from petrol_issues
    union all select vehicle_id, company_id from parts_issues
    union all select vehicle_id, company_id from repairs
  ) c
 where c.company_id = (select id from companies where slug = 'demo')
   and c.vehicle_id is not null
   and not exists (select 1 from fleet f where f.id = c.vehicle_id and f.company_id = c.company_id);
