// trip_log_test.mjs — the Vehicle Log redesign (#510, 2026-09-27).
//
// Thijs: "all information that my guys need to give to be done in 1 screen.
// It's already a mission to get everyone to always log the trips, if they
// have to navigate over multiple screens it's going to get worse." So the
// log-a-trip drawer has NO tabs — every field is in one grid — and this
// suite fails the moment somebody adds tabs to it. The table drops to six
// columns; a logged trip opens read-only (close / delete only).
//
//   node tools/trip_log_test.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse } from '@babel/parser'

const here = dirname(fileURLToPath(import.meta.url))
const APP = readFileSync(join(here, '..', 'src', 'App.jsx'), 'utf8')
const THEME = readFileSync(join(here, '..', 'src', 'theme.js'), 'utf8')
let failed = 0
function check(name, ok, detail = '') { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`); if (!ok) failed++ }
const fn = (name) => { const i = APP.indexOf(`function ${name}(`); const j = APP.indexOf('\nfunction ', i + 10); return APP.slice(i, j < 0 ? undefined : j) }

parse(APP, { sourceType: 'module', plugins: ['jsx'] })
check('App.jsx parses', true)
const vr = fn('VehicleRegister')
const drawerOpen = vr.indexOf('<Drawer title="Log a trip"')
const drawerClose = vr.indexOf('</Drawer>', drawerOpen)
const logDrawer = vr.slice(drawerOpen, drawerClose)
check('log-a-trip is a drawer', drawerOpen > 0)
check('log-a-trip has NO tabs — one screen', !/tabs=\{/.test(logDrawer) && !/onTab=/.test(logDrawer))
for (const field of ['Vehicle', 'Date', 'Driver', 'Purpose', 'Odometer — start', 'Odometer — end', 'Notes (optional)'])
  check(`field on the one screen: ${field}`, logDrawer.includes(`<label>${field}`))
check('driver name box appears only when nobody from the staff list is picked', /!form\.driver_employee_id \? \(/.test(logDrawer))
check('job card box appears only for a maintenance purpose', /isMaintenanceTrip \? \(/.test(logDrawer))
check('save / start trip lives in the drawer footer', /form\.end_km===""\?"Start trip":"Save trip"/.test(vr) && /footer=\{tripFooter\}/.test(vr))
check('save logic unchanged: driver gate, odometer checks, job card required for maintenance', /Pick a qualified driver, or fix the licence in HR first/.test(vr) && /The closing reading can't be lower than the opening one/.test(vr) && /so its cost lands on the right job/.test(vr))
check('rate is still snapshotted on the row', /cost_per_km: rate,/.test(vr))
check('still-out trips are chips with Close trip', /className="chip"/.test(vr) && />Close trip</.test(vr))
check('Enter closes a trip from the chip', /onKeyDown=\{e=>\{ if\(e\.key==="Enter"\) closeTrip\(\); \}\}/.test(vr))
const head = vr.slice(vr.indexOf('<thead>'), vr.indexOf('</thead>'))
check('table has 6 columns', (head.match(/<th[ >]/g) || []).length === 6, String((head.match(/<th[ >]/g) || []).length))
check('rows open the trip drawer', /className="row-open" onClick=\{\(\)=>setOpenTrip\(t\)\}/.test(vr))
check('toolbar: search, vehicle, purpose, month, lodge', /placeholder="Search driver, vehicle, job…"/.test(vr) && /All vehicles/.test(vr) && /All purposes/.test(vr) && /Last month/.test(vr) && /All lodges/.test(vr))
check('trip purposes moved into a drawer (admin)', /<Drawer title="Trip purposes"/.test(vr) && /<TripPurposeManager[^>]*embedded/.test(vr))
const td = fn('TripDrawer')
check('TripDrawer is read-only: close trip / delete only, no inputs', /function TripDrawer\(/.test(APP) && !/<input/.test(td) && />Close trip</.test(td) && />Delete</.test(td))
check('TripDrawer shows the licence check as logged that day', /driver_qualified===true/.test(td) && /driver_qualified===false/.test(td))
for (const cls of ['.toolbar', 'tr.row-open', '.chip', '.badge-warn']) check(`theme has ${cls}`, THEME.includes(cls))
const lastHook = Math.max(vr.lastIndexOf('useState('), vr.lastIndexOf('useMemo('), vr.lastIndexOf('useEffect('))
check('no hook after the return in VehicleRegister', lastHook < vr.indexOf('return (<>'))
// Round 4 (2026-09-27): the five fuel forms are drawers too — one screen each.
for (const t of ['Log bulk diesel delivery', 'Log diesel issue', 'Log tank dip', 'Log petrol purchase', 'Log petrol issue']) {
  const i = APP.indexOf(`<Drawer title="${t}"`)
  const block = i > 0 ? APP.slice(i, APP.indexOf('</Drawer>', i)) : ''
  check(`${t} is a one-screen drawer`, i > 0 && !/tabs=\{/.test(block))
}
check('no fuel form is left as an overlay modal', !/Log Bulk <span>Diesel Delivery|Log Diesel <span>Issue|Log Tank <span>Dip|Log <span>Petrol Purchase|Log <span>Petrol Issue/.test(APP))

console.log(failed ? `\n${failed} check(s) failed` : '\nall trip log checks pass')
process.exit(failed ? 1 : 0)
