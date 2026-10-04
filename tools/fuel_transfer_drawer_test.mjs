// fuel_transfer_drawer_test.mjs — fuel transfers between lodges live behind
// a button with a drawer (Thijs 2026-09-29: "Now lives as a ugly block in the
// screen. Rather make it a button with a drawer also, as we rarely use it").
//   node tools/fuel_transfer_drawer_test.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'App.jsx'), 'utf8')
let passed = 0
const failures = []
const check = (name, ok) => (ok ? passed++ : failures.push(name))
const a = app.indexOf('function FuelTransfers(')
const ft = app.slice(a, app.indexOf('\nfunction ', a + 10))

check('the transfer form is inside a Drawer, opened from a button', /<Drawer title=\{`Transfer \$\{fuel\} to another lodge`\}/.test(ft) && /Transfer \{fuel\}<\/button>/.test(ft))
check('no always-open card block any more', !/className="card"/.test(ft) && !/Between lodges/.test(ft))
check('an arrival waiting to be confirmed still shows on the page, as a chip', /\{incoming\.length\} arriving — confirm/.test(ft))
check('confirm / never-sent and the awaiting list are kept', /onClick=\{\(\)=>confirm\(t\)\}/.test(ft) && /onClick=\{\(\)=>cancel\(t\)\}/.test(ft) && /Sent, not yet confirmed/.test(ft))
const diesel = app.indexOf('+ Log Delivery</button>')
const petrol = app.indexOf('+ Log Purchase</button>')
check('diesel: the button sits next to "+ Log Delivery"', diesel - app.lastIndexOf('<FuelTransfers domain="diesel"', diesel) < 400)
check('petrol: the button sits next to "+ Log Purchase"', petrol - app.lastIndexOf('<FuelTransfers domain="petrol"', petrol) < 400)
check('rendered exactly twice (diesel + petrol)', (app.match(/<FuelTransfers /g) || []).length === 2)

console.log(`fuel_transfer_drawer_test: ${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL ' + f)
process.exit(failures.length ? 1 : 0)
