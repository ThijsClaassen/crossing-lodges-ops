// trip_takeover_test.mjs — a vehicle left logged out (2026-10-04, #549).
//
//   node tools/trip_takeover_test.mjs
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
const failures = []
const check = (name, ok, detail) => (ok ? passed++ : failures.push(`${name}${detail ? ` — ${detail}` : ''}`))

const T = await import(pathToFileURL(join(ROOT, 'src', 'tripTakeover.js')).href)

const trips = [
  { id: 'a', vehicle_id: 'V1', driver_name: 'Sipho', trip_date: '2026-09-30', start_km: 85000, end_km: 85120 },
  { id: 'b', vehicle_id: 'V1', driver_name: 'Jan', trip_date: '2026-10-02', start_km: 85120, end_km: null, notes: 'to Vaalwater' },
  { id: 'c', vehicle_id: 'V2', driver_name: 'Thabo', trip_date: '2026-10-03', start_km: 4000, end_km: 4100 },
]
const open = T.openTripFor(trips, 'V1')
check('finds the trip still open on the vehicle', open?.id === 'b')
check('a vehicle with every trip closed has none', T.openTripFor(trips, 'V2') === null && T.openTripFor(trips, '') === null)

check('takeover needs an opening reading', /opening odometer/.test(T.takeoverProblem(open, '')))
check('the opening reading cannot be below where the open trip started', /85[\s ,]120/.test(T.takeoverProblem(open, '85000') || ''))
check('a reading at or above the open trip start is fine', T.takeoverProblem(open, '85300') === null && T.takeoverProblem(open, 85120) === null)
check('no open trip, no problem', T.takeoverProblem(null, '') === null)

const patch = T.takeoverPatch(open, { newStartKm: 85300, newDriver: 'Thabo', today: '2026-10-04' })
check('the forgotten trip is closed at the new opening reading', patch.end_km === 85300)
check('with a note saying who closed it, when, and why — kept after any existing note', patch.notes.startsWith('to Vaalwater · Not logged back in') && /by Thabo on 2026-10-04/.test(patch.notes))
check('only end_km and notes change (driver, date, purpose stay the original driver\'s)', Object.keys(patch).sort().join() === 'end_km,notes')
check('a trip with no note gets just the takeover note', T.takeoverPatch({ ...open, notes: null }, { newStartKm: 85300, newDriver: 'Thabo', today: '2026-10-04' }).notes.startsWith('Not logged back in'))

const app = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8')
check('the trip form warns who still has the vehicle and offers the tick (on by default)', /Still logged out by <b>\{openOnPicked\.driver_name\}<\/b>/.test(app) && /const \[takeOver, setTakeOver\] = useState\(true\)/.test(app))
check('unticked: saving is refused with a clear message, never two open trips', /if\(open && !takeOver\) return setErr\(/.test(app))
check('ticked: the old trip is closed (patch) before the new one is inserted', /if\(open\) \{\s*const patch = takeoverPatch\([\s\S]{0,120}await sb\.patch\("vehicle_trips", open\.id, patch\)[\s\S]{0,2000}await sb\.insert\("vehicle_trips", row\)/.test(app))
check('picking another vehicle re-ticks the box', /setTakeOver\(true\);\s*\}/.test(app))

console.log(`trip_takeover_test: ${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL ' + f)
process.exit(failures.length ? 1 : 0)
