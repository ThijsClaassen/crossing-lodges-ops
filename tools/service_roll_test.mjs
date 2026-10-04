// service_roll_test.mjs — "Service done" on a workshop invoice (2026-10-04, #548).
//
//   node tools/service_roll_test.mjs
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
const failures = []
const check = (name, ok, detail) => (ok ? passed++ : failures.push(`${name}${detail ? ` — ${detail}` : ''}`))

const S = await import(pathToFileURL(join(ROOT, 'src', 'serviceRoll.js')).href)

const bakkie = { id: 'V1', name: 'Bakkie', last_service_date: '10/01/2026', last_service_km: 80000, service_interval_months: 12, service_interval_km: 10000 }

const done = S.applyServiceDone(bakkie, { date: '04/10/2026', km: '91250' })
check('last service date becomes the invoice date', done.last_service_date === '04/10/2026')
check('last service km becomes the odometer at the service', done.last_service_km === 91250)
check('the vehicle passed in is left alone (a new object comes back)', bakkie.last_service_km === 80000 && done !== bakkie)
check('the intervals are not touched', done.service_interval_months === 12 && done.service_interval_km === 10000)

const next = S.nextServiceAfter(bakkie, { date: '04/10/2026', km: '91250' })
check('next due date = service date + the interval in months', next.dueDate === '04/10/2027', next.dueDate)
check('next due km = odometer + the interval in km (the 10 000 interval)', next.dueKm === 101250, String(next.dueKm))
check('the line reads "whichever comes first" when both are set', /04\/10\/2027 or 101[\s ,]250 km, whichever comes first/.test(S.nextServiceText(next)), S.nextServiceText(next))

const kmOnly = { ...bakkie, service_interval_months: null }
check('km-only vehicle: only the km moves', S.nextServiceAfter(kmOnly, { date: '04/10/2026', km: 91250 }).dueDate === null && S.nextServiceAfter(kmOnly, { date: '04/10/2026', km: 91250 }).dueKm === 101250)
const dateOnly = { ...bakkie, service_interval_km: null }
const blankKm = S.applyServiceDone(dateOnly, { date: '04/10/2026', km: '' })
check('date-only vehicle with no km typed: date moves, km stays as it was', blankKm.last_service_date === '04/10/2026' && blankKm.last_service_km === 80000)
check('ISO dates are read too', S.applyServiceDone(bakkie, { date: '2026-10-04', km: '' }).last_service_date === '04/10/2026')
check('end-of-month: 31/01 + 1 month does not throw', typeof S.nextServiceAfter({ ...bakkie, service_interval_months: 1 }, { date: '31/01/2026', km: '' }).dueDate === 'string')
check('no schedule: says so rather than inventing a date', /no service interval/.test(S.nextServiceText(S.nextServiceAfter({ id: 'x' }, { date: '04/10/2026', km: '' }))))
check('hasServiceSchedule', S.hasServiceSchedule(bakkie) && !S.hasServiceSchedule({ id: 'x' }))

// Wiring in App.jsx
const app = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8')
check('the repair form has the "Service done" tick and an odometer box', /id="svc-done"/.test(app) && /Odometer at service \(km\)/.test(app))
check('the tick never lands in the repairs table (stripped before saving)', /const \{serviceDone, serviceKm, \.\.\.row\} = form;/.test(app))
check('ticked: the vehicle is updated through sbFleet with applyServiceDone', /onServiceDone=\{async \(vehicleId, svc\) => \{[\s\S]{0,300}applyServiceDone\(v, svc\)[\s\S]{0,80}sbFleet\.upd\(next\)/.test(app))
check('the odometer is pre-filled from the latest fuel log when a vehicle is picked', /odometers=\{latestOdometers\(locData\)\}/.test(app) && /serviceKm: odometers\[id\]/.test(app))
check('a failed vehicle update does not lose the repair (it is saved first, then a clear message)', /The repair is saved, but the vehicle's service date could not be updated/.test(app))

console.log(`service_roll_test: ${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL ' + f)
process.exit(failures.length ? 1 : 0)
