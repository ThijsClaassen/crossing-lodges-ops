// The side-drawer detail pattern (readability pass, 2026-09-27). Structural:
// one Drawer component, the vehicle edit uses it, the old pop-up is gone,
// tabs as agreed, Save/Cancel in the footer, Esc closes.
//
//   node tools/drawer_test.mjs
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => readFileSync(join(ROOT, f), 'utf8')
let passed = 0; const failures = []
const check = (n, c) => (c ? passed++ : failures.push(n))
const app = read('src/App.jsx'), css = read('src/theme.js')
check('Drawer component: scrim + aside with head/tabs/body/foot', /function Drawer\(\{ title, meta, tabs, tab, onTab, onClose, footer, children \}\)/.test(app) && /className="drawer-scrim"/.test(app) && /className="drawer-body"/.test(app) && /className="drawer-foot"/.test(app))
check('Esc closes', /if \(e\.key === "Escape"\) onClose\(\);/.test(app))
check('vehicle tabs as agreed', /\{ id:"basics",   label:"Basics" \}[\s\S]*\{ id:"drivers",  label:"Drivers" \}[\s\S]*\{ id:"identity", label:"Identity & insurance" \}[\s\S]*\{ id:"service",  label:"Servicing" \}[\s\S]*\{ id:"costs",    label:"Running costs" \}/.test(app))
check('FleetManager opens the drawer, the vehicle pop-up is gone', /<VehicleDrawer/.test(app) && !/<span>Vehicle \/ Equipment<\/span>/.test(app))
check('Save / Cancel / Remove in the footer', /footer=\{<>[\s\S]*?Save changes[\s\S]*?Cancel[\s\S]*?Remove/.test(app))
check('Drivers tab shows who qualifies today via the same RPC as the trip log', /supabase\.rpc\("drivers_for_vehicle"[\s\S]*?p_on: todayISO\(\)/.test(app) && /Who qualifies today/.test(app))
check('running costs cannot be added before the vehicle exists', /Save the vehicle first — running costs attach to its registration\./.test(app))
check('VehicleDetail (history) no longer carries running costs', !/function VehicleDetail\([^)]*vehicleCosts/.test(app))
check('drawer CSS: fixed right, 640px, full-screen on phone', /\.drawer\{position:fixed;top:0;right:0;bottom:0;width:640px/.test(css) && /\.drawer\{width:100%\}/.test(css))
check('drawer tabs use the accent like the app tabs', /\.drawer-tabs button\.active\{color:\$\{T\.gold\};border-bottom-color:\$\{T\.gold\}/.test(css))
console.log(`drawer_test: ${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL ' + f)
process.exit(failures.length ? 1 : 0)
