// The lodge pick must re-snap once the company's lodge list has ARRIVED
// (2026-09-26). Ops crashed on the new tenant because it did not.
//
// Every app starts with locId/location = 'ZC' and has an effect that snaps
// to LOCATIONS[0] when the pick is not in the list. LOCATIONS is a mutable
// module array — React cannot see it change. So the effect ran twice, both
// times uselessly: at mount, while the list was still empty (early return),
// and on companyId change, BEFORE the new list had loaded (old list, 'ZC'
// still valid). Then the list arrived and nothing re-ran. locId stayed 'ZC',
// locData had no 'ZC', and Ops's dashboard read loc.dieselIssues off
// undefined. The other five apps survived only because they use the pick in
// queries (which return nothing) rather than as an object key.
//
// The fix is one dependency: companyLoading from useCompany() flips false
// exactly when the lodge list is in place. Ops additionally treats a render
// with a lodge list but no matching locData as still-loading.
//
//   node tools/lodge_snap_test.mjs
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OPS = join(dirname(fileURLToPath(import.meta.url)), '..')
// On disk, Ops lives inside crossing-lodges-HR-Linen, which lives in the
// Projects folder; some sandboxes mount every repo flat side by side. Try
// both layouts and take whichever exists — a repo that is in neither place
// is reported, not skipped.
const resolve = (...rels) => rels.map((r) => join(OPS, ...r)).find((p) => existsSync(join(p, 'src', 'App.jsx'))) || join(OPS, ...rels[0])
const APPS = [
  { name: 'Ops', dir: OPS, pick: 'locId' },
  { name: 'Maintenance', dir: resolve(['crossing-lodges-maintenance'], ['..', 'crossing-lodges-maintenance']), pick: 'locId' },
  { name: 'Food', dir: resolve(['..', '..', 'crossing-lodges-food'], ['..', 'crossing-lodges-food']), pick: 'location' },
  { name: 'Beverage', dir: resolve(['..', '..', 'crossing-lodges-beverage', 'crossing-lodges-beverage'], ['..', 'crossing-lodges-beverage', 'crossing-lodges-beverage']), pick: 'location' },
  { name: 'Curio', dir: resolve(['..', '..', 'CL Dashboard', 'crossing-lodges-curio'], ['..', 'crossing-lodges-curio']), pick: 'location' },
  { name: 'HR / Linen', dir: resolve(['..'], ['..', 'crossing-lodges-HR-Linen']), pick: 'location' },
]

let passed = 0
const failures = []
const check = (name, cond, detail) =>
  cond ? passed++ : failures.push(`${name}${detail ? ` — ${detail}` : ''}`)

for (const app of APPS) {
  const file = join(app.dir, 'src', 'App.jsx')
  if (!existsSync(file)) { failures.push(`${app.name}: App.jsx not found at ${app.dir}`); continue }
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

  // Find the snap effect and read its dependency array.
  const re = new RegExp(`LOCATIONS\\.some\\(\\(l\\) => l\\.id === ${app.pick}\\)[\\s\\S]*?\\}, \\[([^\\]]*)\\]\\)`)
  const m = src.match(re)
  check(`${app.name}: has the snap-to-first-lodge effect`, !!m)
  if (!m) continue
  const deps = m[1].split(',').map((s) => s.trim())
  check(`${app.name}: snap effect re-runs when the lodge list has loaded`,
    deps.includes('companyLoading'),
    `deps are [${deps.join(', ')}] — without companyLoading the effect never sees the new list`)
  check(`${app.name}: and still on the pick itself`, deps.includes(app.pick))
  check(`${app.name}: and on companyId`, deps.includes('companyId'))
}

// Ops is the one that indexes state by the pick; it must not render a child
// against a missing entry even for a single frame.
{
  const src = readFileSync(join(OPS, 'src', 'App.jsx'), 'utf8')
  check('Ops treats "lodge list loaded but no data for the pick" as still loading',
    /if \(companyLoading \|\| \(LOCATIONS\.length > 0 && !loc\)\)/.test(src),
    'a child would read loc.dieselIssues off undefined')
  const guardAt = src.indexOf('LOCATIONS.length > 0 && !loc')
  const locAt = src.indexOf('const loc        = locData[locId];')
  check('and the guard comes after loc is derived', locAt > 0 && guardAt > locAt)
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`)
  process.exit(1)
}
console.log('Every app re-snaps its lodge pick once the company\'s lodges have loaded.\n')
