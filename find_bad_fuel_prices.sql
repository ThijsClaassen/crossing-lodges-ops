-- Find the fuel delivery that is inflating every vehicle's cost (2026-09-24).
--
-- WHY. Fuel cost on the Cost Summary is litres x the weighted-average price
-- paid, derived from diesel_deliveries and petrol_purchases. One row with the
-- delivery TOTAL typed into price_per_litre drags that average up and
-- overstates EVERY vehicle by the same proportion, forever, silently.
--
-- Defender GV read R82,948.34 against R8,320.50 on the vehicle sheet — a
-- factor of about 9.97, which points at a derived diesel price near R204/litre
-- against a real one near R20.50.
--
-- Read-only. Nothing here writes. Query 4 is the fix and is commented out.

-- ---------------------------------------------------------------------------
-- 1) THE HEADLINE. What price is the app actually using, per lodge?
--
-- Anything outside roughly R15-R30 is the problem. This is the exact
-- calculation fuelPricesFrom() does, so it will agree with the screen.
select
  'diesel' as fuel,
  d.location_id,
  count(*)                                             as deliveries,
  round(sum(d.litres)::numeric, 1)                     as total_litres,
  round(sum(d.litres * d.price_per_litre)::numeric, 2) as total_spend,
  round((sum(d.litres * d.price_per_litre) / nullif(sum(d.litres), 0))::numeric, 2)
                                                       as weighted_avg_price
from diesel_deliveries d
join companies c on c.id = d.company_id
where c.slug = 'crossing-lodges'
  and d.litres > 0 and d.price_per_litre > 0
group by d.location_id

union all

select
  'petrol',
  p.location_id,
  count(*),
  round(sum(p.litres)::numeric, 1),
  round(sum(p.litres * p.price_per_litre)::numeric, 2),
  round((sum(p.litres * p.price_per_litre) / nullif(sum(p.litres), 0))::numeric, 2)
from petrol_purchases p
join companies c on c.id = p.company_id
where c.slug = 'crossing-lodges'
  and p.litres > 0 and p.price_per_litre > 0
group by p.location_id
order by fuel, location_id;


-- ---------------------------------------------------------------------------
-- 2) THE CULPRITS. Every row with an impossible price per litre.
--
-- implied_total is what the row is claiming it cost. If that number matches a
-- real invoice, the total went into the price field and the litres are right.
--
-- select 'diesel' as fuel, d.id, d.location_id, d.date, d.litres,
--        d.price_per_litre,
--        round((d.litres * d.price_per_litre)::numeric, 2) as implied_total,
--        d.supplier, d.invoice_no
--   from diesel_deliveries d
--   join companies c on c.id = d.company_id
--  where c.slug = 'crossing-lodges'
--    and (d.price_per_litre < 5 or d.price_per_litre > 60)
-- union all
-- select 'petrol', p.id, p.location_id, p.date, p.litres,
--        p.price_per_litre,
--        round((p.litres * p.price_per_litre)::numeric, 2),
--        p.station, null
--   from petrol_purchases p
--   join companies c on c.id = p.company_id
--  where c.slug = 'crossing-lodges'
--    and (p.price_per_litre < 5 or p.price_per_litre > 60)
--  order by fuel, date;


-- ---------------------------------------------------------------------------
-- 3) THE PROOF. What the Defender GV should cost at a corrected price.
--
-- Run this AFTER query 2 tells you the real price. Replace 20.50 with it.
-- If the answer lands near R8,320.50, the bad delivery was the whole story.
--
-- select v.name,
--        round(sum(i.litres)::numeric, 1)          as litres_issued,
--        round((sum(i.litres) * 20.50)::numeric, 2) as fuel_cost_at_corrected_price
--   from diesel_issues i
--   join fleet v on v.id = i.vehicle
--   join companies c on c.id = i.company_id
--  where c.slug = 'crossing-lodges'
--    and v.name ilike '%defender%'
--  group by v.name;


-- ---------------------------------------------------------------------------
-- 4) THE FIX. Commented out — DO NOT run until query 2 has shown you the rows
--    and you have the real invoice in front of you.
--
-- Two different mistakes need two different corrections, so there is no
-- one-size update here:
--
--   a) The TOTAL was typed into price_per_litre, and litres are correct:
--        update diesel_deliveries
--           set price_per_litre = price_per_litre / litres
--         where id = '<the id from query 2>';
--      (That turns R20,500 on a 1,000 L delivery into R20.50.)
--
--   b) The price was typed in cents:
--        update diesel_deliveries
--           set price_per_litre = price_per_litre / 100
--         where id = '<the id from query 2>';
--
-- Do them ONE ID AT A TIME. A blanket update across the table would "correct"
-- the rows that were right all along, and there is no undo.
--
-- Re-run query 1 afterwards: the weighted average should come back into the
-- R15-R30 band, and the red banner in the app should disappear by itself.
