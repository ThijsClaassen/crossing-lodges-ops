// Meter checks for fuel issues (#564, 2026-10-08). Thijs: diesel and petrol
// lists must be in date order "so we can see if meter numbers still make
// sense". With the list in order, this flags the readings that don't:
//
//   - Diesel pump meter: an issue's opening reading lower than the closing
//     reading of the issue before it (by date), or a closing reading lower
//     than its own opening.
//   - Vehicle mileage: a vehicle's mileage lower than on its previous fill.
//
// Flags only — nothing is blocked or changed. A typo or a backdated entry is
// exactly what this is meant to make visible.
import { newestFirst } from './newestFirst.js'

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/[\s,]/g, ''))
  return Number.isFinite(n) ? n : null
}

// Oldest first: the exact reverse of the list's newest-first order, so the
// same tie-break applies (same date → the one entered first comes first).
export const oldestFirst = (rows) => newestFirst(rows).reverse()

// { [issueId]: ["message", …] }
export function meterFlags(issues, { pumpMeter = false } = {}) {
  const flags = {}
  const add = (id, msg) => { (flags[id] = flags[id] || []).push(msg) }
  const ordered = oldestFirst(issues)

  if (pumpMeter) {
    let prev = null
    for (const i of ordered) {
      const open = num(i.open)
      const close = num(i.close)
      if (open !== null && close !== null && close < open) add(i.id, `Closing meter ${close} is lower than the opening ${open}.`)
      if (prev && open !== null && num(prev.close) !== null && open < num(prev.close)) {
        add(i.id, `Opening meter ${open} is lower than the previous closing ${num(prev.close)} (${prev.date}).`)
      }
      if (close !== null || open !== null) prev = i
    }
  }

  const lastByVehicle = {}
  for (const i of ordered) {
    const km = num(i.mileage)
    if (!i.vehicle || km === null) continue
    const last = lastByVehicle[i.vehicle]
    if (last && km < last.km) add(i.id, `Mileage ${km} is lower than this vehicle's previous ${last.km} (${last.date}).`)
    lastByVehicle[i.vehicle] = { km, date: i.date }
  }
  return flags
}
