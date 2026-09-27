// Driver gate on the vehicle log (#485, 2026-09-27). Structural: the rule
// itself is executed in the HR app's qualifications_test.mjs (same table as
// licence_class_rank() in SQL); here we check the Ops side honours it —
// greyed with the reason, never hidden; blocked on save; snapshot stored;
// history never rewritten.
//
//   node tools/driver_gate_test.mjs
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => readFileSync(join(ROOT, f), 'utf8')
let passed = 0
const failures = []
const check = (name, cond) => (cond ? passed++ : failures.push(name))

const app = read('src/App.jsx')
const sql = read('add_vehicle_licence_class.sql').replace(/--[^\n]*/g, '')

check('fleet gets required_licence_class + requires_pdp', /alter table fleet add column if not exists required_licence_class text/.test(sql) && /requires_pdp boolean not null default false/.test(sql))
check('trips get a qualification snapshot', /alter table vehicle_trips add column if not exists driver_qualified boolean/.test(sql) && /driver_licence_class text/.test(sql))
check('licence class list matches HR', /const LICENCE_CLASSES = \["A1","A","B","EB","C1","C","EC1","EC"\]/.test(app))
check('vehicle drawer offers the code and PDP, and hides the Drivers tab for equipment', /Licence code needed/.test(app) && /Needs a PDP\?/.test(app) && /\.filter\(t => !isEquipment \|\| \(t\.id !== "drivers"\)\)/.test(app))
check('fleet row round-trips both fields', /required_licence_class:  v\.required_licence_class \|\| null/.test(app) && /required_licence_class:  r\.required_licence_class \|\| ""/.test(app))
check('fleet table shows what the driver needs', /<th>Driver needs<\/th>/.test(app))
check('eligibility asked of drivers_for_vehicle on the TRIP DATE', /supabase\.rpc\("drivers_for_vehicle", \{ p_company_id: companyId, p_required_class: requirement, p_needs_pdp: needsPdp, p_on: form\.trip_date \|\| todayISO\(\) \}\)/.test(app))
check('no requirement → no check (eligibility empty)', /if\(!requirement && !needsPdp\)\{ setEligibility\(\{\}\); return; \}/.test(app))
check('unqualified staff are greyed with the reason, not filtered out', /hint:el\.reason, disabled:true/.test(app) && !/hrEmployees\.filter\(e=>eligibility/.test(app))
check('SearchableSelect refuses a disabled option', /if \(opt\.disabled\) return;/.test(app))
check('save refuses an unqualified staff driver with the reason', /if\(driverCheck && !driverCheck\.qualifies\) return setErr/.test(app))
check('the snapshot is written on the trip', /driver_qualified: driverCheck \? !!driverCheck\.qualifies : null/.test(app) && /driver_licence_class: driverCheck\?\.licence_class \|\| null/.test(app))
check('history: an old trip is flagged from its stored snapshot, never recomputed', /t\.driver_qualified===false && <span/.test(app) && !/eligibility\[t\.driver_employee_id\]/.test(app))
check('free-text (non-staff) drivers are still allowed — guests and contractors', /someone not on the staff list/.test(app))

console.log(`driver_gate_test: ${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL ' + f)
process.exit(failures.length ? 1 : 0)
