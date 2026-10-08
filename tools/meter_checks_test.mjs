// Meter checks on fuel issues (#564, 2026-10-08) and the dip fix.
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
let passed = 0
const check = (name, ok, detail = '') => (ok ? passed++ : failures.push(`${name}${detail ? ' — ' + detail : ''}`))
const { meterFlags, oldestFirst } = await import(pathToFileURL(join(ROOT, 'src', 'meterChecks.js')).href)
const { newestFirst } = await import(pathToFileURL(join(ROOT, 'src', 'newestFirst.js')).href)

// Diesel pump meter, entered out of order: 03/02 was typed in after 05/02.
const diesel = [
  { id: 'a', date: '01/02/2026', open: 1000, close: 1050, vehicle: 'LC', mileage: '120000', created_at: '2026-02-01T08:00' },
  { id: 'c', date: '05/02/2026', open: 1080, close: 1120, vehicle: 'LC', mileage: '120900', created_at: '2026-02-05T08:00' },
  { id: 'b', date: '03/02/2026', open: 1050, close: 1080, vehicle: 'LC', mileage: '120400', created_at: '2026-02-06T08:00' },
]
check('in date order the readings follow on: no flags', Object.keys(meterFlags(diesel, { pumpMeter: true })).length === 0, JSON.stringify(meterFlags(diesel, { pumpMeter: true })))
check('oldestFirst is the exact reverse of the list order', oldestFirst(diesel).map((r) => r.id).join() === newestFirst(diesel).map((r) => r.id).reverse().join())

const typo = [...diesel, { id: 'd', date: '06/02/2026', open: 1020, close: 1060, vehicle: 'LC', mileage: '121300' }]
const f1 = meterFlags(typo, { pumpMeter: true })
check('opening lower than the previous closing is flagged', f1.d && /Opening meter 1020 is lower than the previous closing 1120 \(05\/02\/2026\)/.test(f1.d[0]), JSON.stringify(f1))
check('only that row is flagged', Object.keys(f1).join() === 'd')

const back = [{ id: 'e', date: '07/02/2026', open: 1200, close: 1150 }]
check('closing lower than its own opening is flagged', /Closing meter 1150 is lower than the opening 1200/.test(meterFlags(back, { pumpMeter: true }).e?.[0] || ''))

// Mileage per vehicle
const km = [
  { id: 'p1', date: '2026-03-01', vehicle: 'HILUX', mileage: '50 000' },
  { id: 'p2', date: '2026-03-05', vehicle: 'HILUX', mileage: '49800' },
  { id: 'q1', date: '2026-03-02', vehicle: 'QUAD', mileage: '900' },
  { id: 'q2', date: '2026-03-06', vehicle: 'QUAD', mileage: '950' },
]
const f2 = meterFlags(km)
check('a vehicle\'s mileage going down is flagged ("50 000" with a space still reads as a number)', f2.p2 && /Mileage 49800 is lower than this vehicle's previous 50000/.test(f2.p2[0]), JSON.stringify(f2))
check('other vehicles are compared only with themselves', !f2.q1 && !f2.q2)
check('petrol (no pump meter): no meter flags, only mileage', !Object.values(meterFlags([{ id: 'x', date: '2026-01-01', open: 9, close: 1 }])).length)
check('rows without vehicle or mileage are skipped', Object.keys(meterFlags([{ id: 'n', date: '2026-01-01', mileage: '' }, { id: 'm', date: '2026-01-02', vehicle: 'LC' }])).length === 0)

// The dip bug: "Last dip" took the wrong dip across a month change.
const dips = [
  { id: 'jan31', date: '31/01/2026', litres: 400 },
  { id: 'feb05', date: '05/02/2026', litres: 900 },
]
check('Last dip is the newest by real date (05/02 beats 31/01)', newestFirst(dips)[0].id === 'feb05')
check('…which the old text sort got wrong', [...dips].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0].id === 'jan31')

console.log(`meter_checks_test: ${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL ' + f)
process.exit(failures.length ? 1 : 0)
