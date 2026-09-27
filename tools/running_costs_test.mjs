// Full vehicle costing (#488): recurring, one-off and depreciation maths
// EXECUTED; the wiring into computeVehicleCosts / trip rate checked.
//
//   node tools/running_costs_test.mjs
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => readFileSync(join(ROOT, f), 'utf8')
let passed = 0
const failures = []
const check = (name, cond, detail) => (cond ? passed++ : failures.push(`${name}${detail ? ` — ${detail}` : ''}`))

const m = await import('data:text/javascript;base64,' + Buffer.from(read('src/runningCosts.js')).toString('base64'))
const W = { windowStart: '2026-01-01', windowEnd: '2026-12-31' }        // the year
const SEP = { windowStart: '2026-09-01', windowEnd: '2026-09-30' }      // one month

// months live
check('a cost running all year is 12 months', m.monthsLive({ start: '2025-06-15', end: null, ...W }) === 12)
check('starting mid-window counts from its month', m.monthsLive({ start: '2026-10-20', end: null, ...W }) === 3)
check('ended before the window is 0', m.monthsLive({ start: '2024-01-01', end: '2025-12-31', ...W }) === 0)
check('start and end in the same month is 1', m.monthsLive({ start: '2026-09-03', end: '2026-09-28', ...W }) === 1)

// recurring / once
const tracker = { kind: 'tracker', period: 'monthly', amount: 350, start_date: '2025-01-01', end_date: null }
const disk = { kind: 'licence_disk', period: 'annual', amount: 1200, start_date: '2025-04-01', end_date: null }
const toll = { kind: 'tolls', period: 'once', amount: 90, start_date: '2026-09-12' }
const oldFine = { kind: 'fines', period: 'once', amount: 500, start_date: '2025-11-05' }
check('monthly × months', m.costInWindow(tracker, W) === 4200 && m.costInWindow(tracker, SEP) === 350)
check('annual spread by twelfths', m.costInWindow(disk, W) === 1200 && m.costInWindow(disk, SEP) === 100)
check('once counts only in the window holding its date', m.costInWindow(toll, SEP) === 90 && m.costInWindow(toll, W) === 90 && m.costInWindow(oldFine, W) === 0)
check('zero/blank amount contributes nothing', m.costInWindow({ ...tracker, amount: '' }, W) === 0)

// depreciation — same formula as the register: cost × rate / 12 from the month after purchase
const cruiser = { fleet_id: 'KZC 123 L', cost_price: 600000, depreciation_rate: 0.2, useful_life_years: 5, purchase_date: '2024-03-15' }
check('monthly depreciation = cost × rate ÷ 12', m.monthlyDepreciation(cruiser) === 10000)
check('a full year of depreciation', m.depreciationInWindow(cruiser, W) === 120000)
check('one month', m.depreciationInWindow(cruiser, SEP) === 10000)
check('starts the month AFTER purchase', m.depreciationInWindow(cruiser, { windowStart: '2024-03-01', windowEnd: '2024-04-30' }) === 10000)
check('stops at end of useful life (5y → last month Mar 2029)', m.depreciationInWindow(cruiser, { windowStart: '2029-01-01', windowEnd: '2029-12-31' }) === 30000)
check('stops at disposal', m.depreciationInWindow({ ...cruiser, disposal_date: '2026-09-20' }, W) === 90000)
check('never more than cost', m.depreciationInWindow({ ...cruiser, useful_life_years: null }, { windowStart: '2024-01-01', windowEnd: '2040-12-31' }) === 600000)
check('no rate → nothing', m.depreciationInWindow({ ...cruiser, depreciation_rate: null }, W) === 0)

// per vehicle
const rc = m.runningCostsFor({ vehicleId: 'KZC 123 L', costRows: [tracker, disk, toll, oldFine].map((r) => ({ ...r, vehicle_id: 'KZC 123 L' })).concat([{ ...tracker, vehicle_id: 'OTHER' }]), assets: [cruiser], ...W })
check('recurring / oneOff / depreciation split, other vehicles ignored', rc.recurring === 5400 && rc.oneOff === 90 && rc.depreciation === 120000)
check('by kind for the tooltip', rc.byKind.tracker === 4200 && rc.byKind.licence_disk === 1200 && rc.byKind.tolls === 90 && !('fines' in rc.byKind))

// wiring
const app = read('src/App.jsx')
check('computeVehicleCosts takes vehicleCosts + assets + monthWindow', /export function computeVehicleCosts\(\{ locData, fleet, locIds, inMonth = null, allLocIds = null, vehicleCosts = \[\], assets = \[\], monthWindow = null \}\)/.test(app))
check('total includes the new costs', /const total = d\.fuel \+ d\.parts \+ d\.repairs \+ insurance \+ recurring \+ oneOff \+ depreciation;/.test(app))
check('split by lodge km share like insurance', /recurring = rc\.recurring \* share; oneOff = rc\.oneOff \* share; depreciation = rc\.depreciation \* share;/.test(app))
check('the trip running rate gets them too (this is what Maintenance bills)', /computeVehicleCosts\(\{ locData, fleet, locIds: LOCATIONS\.map\(l=>l\.id\), vehicleCosts, assets \}\)/.test(app))
check('Cost Summary passes them, monthly view gets a month window', /\{ windowStart: new Date\(monthCursor\.y, monthCursor\.m, 1\), windowEnd: new Date\(monthCursor\.y, monthCursor\.m \+ 1, 0\) \}/.test(app) && /vehicleCosts, assets, monthWindow,/.test(app))
check('Cost Summary shows a Fixed & other column with a breakdown', (app.match(/Fixed &amp; other/g) || []).length === 2 && /title=\{`Insurance \$\{fmtR\(r\.insurance\|\|0\)\} · recurring/.test(app))
check('loads vehicle_costs and linked fixed_assets, pre-migration safe', /sb\.select\("vehicle_costs", cf\)\.catch\(\(\)=>\[\]\)/.test(app) && /fixed_assets", `\$\{cf\}&fleet_id=not\.is\.null&select=/.test(app))
check('Running costs live in the vehicle drawer (edit page), not the history modal (#509)', /\{ id:"costs",    label:"Running costs" \}/.test(app) && /sb\.insert\("vehicle_costs", row\)/.test(app) && /sb\.delete\("vehicle_costs", c\.id\)/.test(app) && !/label:`Running costs \(/.test(app))
check('says when no asset is linked (no depreciation counted)', /No fixed asset linked to this vehicle, so no depreciation is counted/.test(app))
const sql = read('add_vehicle_running_costs.sql').replace(/--[^\n]*/g, '')
check('vehicle_costs: kind free text, period constrained, dates sane', /period\s+text not null check \(period in \('monthly', 'annual', 'once'\)\)/.test(sql) && /end_date is null or end_date >= start_date/.test(sql) && !/kind\s+text not null check/.test(sql))

console.log(`running_costs_test: ${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL ' + f)
process.exit(failures.length ? 1 : 0)
