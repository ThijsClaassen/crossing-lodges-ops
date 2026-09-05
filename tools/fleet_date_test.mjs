// Behavioural tests for the fleet licence/service date logic.
//
// Why this exists: the demo fleet showed "Expires in null days" on eight
// rows. The null was the visible symptom; the actual defect was that
// `null <= LICENSE_WARN_DAYS` is true in JavaScript, so every date the
// parser could not read was silently filed as "expiring soon" and shown as
// a fleet alert. A false alarm is worse than a missing one — it trains the
// user to ignore the panel.
//
// This extracts the real helpers out of App.jsx rather than restating them,
// so the assertions run the shipped code. A copy here would drift and then
// prove nothing.
//
//   node tools/fleet_date_test.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'src', 'App.jsx'), 'utf8')

// --- Extract the block, with the boundaries asserted -----------------------
const START = 'const LICENSE_WARN_DAYS'
const END = '// ─── SELF-SERVICED VEHICLES'
const i = src.indexOf(START)
const j = src.indexOf(END)
if (i === -1) throw new Error(`Could not find start marker: ${START}`)
if (j === -1) throw new Error(`Could not find end marker: ${END}`)
if (j <= i) throw new Error('End marker precedes start marker — App.jsx was reordered')

const block = src.slice(i, j)

for (const needed of [
  'const parseDMY', 'const fmtDMY', 'const daysUntil',
  'function vehicleStatus', 'function buildFleetAlerts', 'const severityOf',
])
  if (!block.includes(needed)) throw new Error(`Extracted block is missing ${needed}`)

const { parseDMY, fmtDMY, daysUntil, vehicleStatus, buildFleetAlerts } = await import(
  'data:text/javascript,' +
    encodeURIComponent(
      block +
        '\nexport { parseDMY, fmtDMY, daysUntil, vehicleStatus, buildFleetAlerts };',
    )
)

let passed = 0
const failures = []
const check = (name, cond, detail) =>
  cond ? passed++ : failures.push(`${name}${detail ? ` — ${detail}` : ''}`)

// A fixed reference point so the assertions don't drift with the calendar.
const dmyOffset = (n) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
const isoOffset = (n) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// --- 1. parseDMY reads both formats ---------------------------------------
check('DD/MM/YYYY parses', parseDMY('06/10/2026')?.getFullYear() === 2026)
check('DD/MM/YYYY reads day and month the right way round',
  parseDMY('06/10/2026')?.getDate() === 6 && parseDMY('06/10/2026')?.getMonth() === 9,
  `got ${parseDMY('06/10/2026')}`)
check('ISO YYYY-MM-DD parses', parseDMY('2026-10-06')?.getFullYear() === 2026)
check('ISO reads day and month the right way round',
  parseDMY('2026-10-06')?.getDate() === 6 && parseDMY('2026-10-06')?.getMonth() === 9,
  `got ${parseDMY('2026-10-06')}`)
check('the two formats agree on the same day',
  parseDMY('06/10/2026').getTime() === parseDMY('2026-10-06').getTime())
check('surrounding whitespace is tolerated', parseDMY('  2026-10-06  ')?.getDate() === 6)

for (const bad of ['', null, undefined, 'tomorrow', '2026/10/06/1', '06-10-2026', 'not a date'])
  check(`garbage ${JSON.stringify(bad)} yields null`, parseDMY(bad) === null, `got ${parseDMY(bad)}`)

// --- 2. fmtDMY must not throw on null -------------------------------------
// It is called on parseDMY's output; throwing would white-screen the page
// over a single unreadable row.
check('fmtDMY(null) returns null rather than throwing', fmtDMY(null) === null)
check('fmtDMY(undefined) returns null rather than throwing', fmtDMY(undefined) === null)
check('fmtDMY pads single digits', fmtDMY(new Date(2026, 0, 5)) === '05/01/2026', fmtDMY(new Date(2026, 0, 5)))

// --- 3. daysUntil ---------------------------------------------------------
check('daysUntil today is 0', daysUntil(dmyOffset(0)) === 0, `${daysUntil(dmyOffset(0))}`)
check('daysUntil counts forward', daysUntil(dmyOffset(30)) === 30, `${daysUntil(dmyOffset(30))}`)
check('daysUntil counts backward', daysUntil(dmyOffset(-5)) === -5, `${daysUntil(dmyOffset(-5))}`)
check('daysUntil works on ISO too', daysUntil(isoOffset(30)) === 30, `${daysUntil(isoOffset(30))}`)
check('daysUntil on garbage is null', daysUntil('rubbish') === null)

// --- 4. The bug this file was written for ---------------------------------
// An unreadable licence date must produce NO alert, not a "soon" one.
{
  const st = vehicleStatus({ license_expiry: 'rubbish' }, null)
  check('an unreadable licence date produces no licence status at all',
    st.license === null,
    `got ${JSON.stringify(st.license)}`)
}
{
  // The exact shape of the original defect: ISO in a DD/MM/YYYY column.
  // Before the fix this returned { days: null, state: 'soon' }.
  const st = vehicleStatus({ license_expiry: isoOffset(400) }, null)
  check('an ISO licence date 400 days out is NOT an alert',
    st.license && st.license.state === 'ok',
    `got ${JSON.stringify(st.license)}`)
  check('and its day count is a real number',
    st.license && st.license.days === 400,
    `got ${st.license?.days}`)
  check('and it displays in the app\'s own DD/MM/YYYY',
    st.license && /^\d{2}\/\d{2}\/\d{4}$/.test(st.license.date),
    `got ${st.license?.date}`)
}

// --- 5. Licence state boundaries ------------------------------------------
for (const [days, want] of [[-1, 'overdue'], [0, 'soon'], [14, 'soon'], [15, 'ok'], [400, 'ok']]) {
  for (const [label, fmt] of [['DD/MM/YYYY', dmyOffset], ['ISO', isoOffset]]) {
    const st = vehicleStatus({ license_expiry: fmt(days) }, null)
    check(`licence ${days} days out (${label}) is "${want}"`,
      st.license?.state === want,
      `got ${st.license?.state}`)
  }
}

// --- 6. Service standing ---------------------------------------------------
{
  // Date-only schedule, well inside its interval.
  const st = vehicleStatus(
    { last_service_date: dmyOffset(-30), service_interval_months: 6 }, null)
  check('a recent date-based service is ok', st.service?.state === 'ok', `got ${st.service?.state}`)
  check('and a due date is computed', /^\d{2}\/\d{2}\/\d{4}$/.test(st.service?.dueDate || ''), `got ${st.service?.dueDate}`)
}
{
  // The same schedule expressed in ISO used to fall through to km-only,
  // silently losing the date half of the rule.
  const st = vehicleStatus(
    { last_service_date: isoOffset(-30), service_interval_months: 6 }, null)
  check('an ISO last-service date still yields a due date',
    st.service?.dueDate != null, `got ${st.service?.dueDate}`)
  check('and a day count', st.service?.daysLeft != null, `got ${st.service?.daysLeft}`)
}
{
  const st = vehicleStatus(
    { last_service_date: dmyOffset(-400), service_interval_months: 6 }, null)
  check('a long-overdue date-based service is overdue', st.service?.state === 'overdue', `got ${st.service?.state}`)
}
{
  const st = vehicleStatus({ last_service_km: 60000, service_interval_km: 10000 }, 104257)
  check('km past due is overdue', st.service?.state === 'overdue', `got ${st.service?.state}`)
  check('km shortfall is reported', st.service?.kmLeft === -34257, `got ${st.service?.kmLeft}`)
}
{
  const st = vehicleStatus({ last_service_km: 60000, service_interval_km: 10000 }, 69700)
  check('within 500km is "soon"', st.service?.state === 'soon', `got ${st.service?.state}`)
}
{
  // Both rules present: whichever bites first wins.
  const st = vehicleStatus(
    { last_service_date: dmyOffset(-30), service_interval_months: 6,
      last_service_km: 60000, service_interval_km: 10000 }, 104257)
  check('date ok + km overdue = overdue', st.service?.state === 'overdue', `got ${st.service?.state}`)
}
{
  const st = vehicleStatus({}, null)
  check('a vehicle with no schedule at all has no service status', st.service === null)
  check('and no licence status', st.license === null)
}
{
  // An unreadable last-service date must not throw via fmtDMY.
  let threw = null
  try { vehicleStatus({ last_service_date: 'rubbish', service_interval_months: 6 }, null) }
  catch (e) { threw = e }
  check('an unreadable last-service date does not throw', threw === null, String(threw))
}

// --- 7. Alert ordering -----------------------------------------------------
// The review's headline finding: the panel listed a Land Cruiser 34,257 km
// past due for service at exactly the same weight as a licence disk expiring
// in eighteen months. Ranking has to be by how far past its OWN interval a
// thing is, not by the raw size of the number.
{
  const fleet = [
    // 3.4 service intervals overdue — the vehicle that shouldn't be driven.
    { id: 'BCJ 418 L', name: 'Land Cruiser 1', last_service_km: 70000, service_interval_km: 10000 },
    // Licence expired 8 days ago — real, but a fortnight's problem.
    { id: 'BCK 902 L', name: 'Land Cruiser 2', license_expiry: dmyOffset(-8) },
    // Licence due in 10 days — not overdue at all.
    { id: 'BDF 275 L', name: 'Hilux Support', license_expiry: dmyOffset(10) },
    // Service due in 200 km — also merely coming up.
    { id: 'BCR 731 L', name: 'Quantum Shuttle', last_service_km: 60000, service_interval_km: 10000 },
  ]
  const odoData = { L1: { dieselIssues: [
    { vehicle: 'BCJ 418 L', mileage: 104257 },
    { vehicle: 'BCR 731 L', mileage: 69800 },
  ], petrolIssues: [] } }

  const rows = buildFleetAlerts(fleet, odoData)
  check('all four vehicles raise an alert', rows.length === 4, `got ${rows.length}`)

  const names = rows.map(r => r.vehicle.name)
  check('the 34,257km-overdue vehicle sorts first',
    names[0] === 'Land Cruiser 1', `order was ${names.join(' | ')}`)
  check('the expired licence sorts second',
    names[1] === 'Land Cruiser 2', `order was ${names.join(' | ')}`)

  const overdue = rows.filter(r => r.state === 'overdue')
  const soon = rows.filter(r => r.state !== 'overdue')
  check('exactly two rows are overdue', overdue.length === 2, `got ${overdue.length}`)
  check('every overdue row sorts above every coming-up row',
    rows.findIndex(r => r.state !== 'overdue') === overdue.length,
    `order was ${rows.map(r => r.state).join(' | ')}`)
  check('overdue rows have positive severity',
    overdue.every(r => r.severity > 0), JSON.stringify(overdue.map(r => r.severity)))
  check('coming-up rows have negative severity',
    soon.every(r => r.severity < 0), JSON.stringify(soon.map(r => r.severity)))
  check('within "coming up", the most imminent comes first',
    soon[0].vehicle.name === 'Quantum Shuttle',
    `got ${soon.map(n => n.vehicle.name).join(' | ')} (${soon.map(r => r.severity.toFixed(3))})`)
}
{
  // Severity must be normalised, not raw. A licence 300 days expired is
  // still less than one year overdue; a service 2 intervals past is worse,
  // even though 300 is a much bigger number than 2.
  const rows = buildFleetAlerts([
    { id: 'A', name: 'Old Licence', license_expiry: dmyOffset(-300) },
    { id: 'B', name: 'Skipped Service', last_service_km: 50000, service_interval_km: 10000 },
  ], { L1: { dieselIssues: [{ vehicle: 'B', mileage: 80000 }], petrolIssues: [] } })
  check('2 intervals of missed service outranks a 300-day-old licence',
    rows[0].vehicle.name === 'Skipped Service',
    `order was ${rows.map(r => `${r.vehicle.name}:${r.severity.toFixed(2)}`).join(' | ')}`)
}
{
  const rows = buildFleetAlerts([{ id: 'A', name: 'Fine', license_expiry: dmyOffset(400) }], {})
  check('a healthy vehicle raises no alert at all', rows.length === 0, `got ${rows.length}`)
}
{
  // The demo bug end to end: eight ISO-dated vehicles, none of them actually
  // due, used to produce eight "expires in null days" alerts.
  const fleet = Array.from({ length: 8 }, (_, n) => ({
    id: `V${n}`, name: `Vehicle ${n}`, license_expiry: isoOffset(200 + n),
  }))
  check('eight healthy ISO-dated vehicles raise zero alerts',
    buildFleetAlerts(fleet, {}).length === 0,
    `got ${buildFleetAlerts(fleet, {}).length}`)
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`)
  process.exit(1)
}
console.log('All fleet date assertions pass.\n')
