// The rest of what a vehicle costs (#488, 2026-09-27). Pure — executed by
// tools/running_costs_test.mjs. No imports.
//
// Fuel, parts, repairs and insurance were counted; these were not:
//   * recurring costs with no transaction anywhere — tracker subscription,
//     licence disk, roadworthy, radio licence — one row each in
//     vehicle_costs, monthly or annual, with a start and optional end;
//   * one-off costs — tolls, fines, towing, cleaning — a dated row each;
//   * depreciation — read from the Finance Dashboard's fixed asset register
//     through fixed_assets.fleet_id (#483). Straight-line, same formula the
//     register uses (cost × rate ÷ 12 per month, from the month after
//     purchase, capped at useful life and at cost), so the two never
//     disagree.
// Thijs (2026-09-27): tyres go under repairs; finance/lease instalments and
// service plans stay out for now.
//
// All three flow into computeVehicleCosts(), so the Cost Summary, the trip
// running rate and Maintenance's internal billing move together.

export const COST_KINDS = [
  { id: 'tracker', label: 'Tracker / telematics', defaultPeriod: 'monthly' },
  { id: 'licence_disk', label: 'Licence disk renewal', defaultPeriod: 'annual' },
  { id: 'roadworthy', label: 'Roadworthy / COF', defaultPeriod: 'annual' },
  { id: 'radio_licence', label: 'Two-way radio licence', defaultPeriod: 'annual' },
  { id: 'tolls', label: 'Tolls', defaultPeriod: 'once' },
  { id: 'fines', label: 'Traffic fine', defaultPeriod: 'once' },
  { id: 'towing', label: 'Towing / breakdown', defaultPeriod: 'once' },
  { id: 'cleaning', label: 'Cleaning / valet', defaultPeriod: 'once' },
  { id: 'other', label: 'Other', defaultPeriod: 'monthly' },
]
export const KIND_LABEL = Object.fromEntries(COST_KINDS.map((k) => [k.id, k.label]))
export const PERIODS = ['monthly', 'annual', 'once']

const ym = (d) => d.getFullYear() * 12 + d.getMonth()
const toDate = (v) => {
  if (!v) return null
  if (v instanceof Date) return v
  const s = String(v).slice(0, 10)
  const d = new Date(`${s}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

// Whole months a recurring cost is live inside a window, both ends
// inclusive at month grain: a cost starting 15 Jan counted in a window
// Jan–Mar is 3 months. `end` null = still running.
export function monthsLive({ start, end, windowStart, windowEnd }) {
  const s = toDate(start), e = toDate(end), ws = toDate(windowStart), we = toDate(windowEnd)
  if (!s || !ws || !we) return 0
  const from = Math.max(ym(s), ym(ws))
  const to = Math.min(e ? ym(e) : Infinity, ym(we))
  return Math.max(0, to - from + 1)
}

// Rand a single vehicle_costs row contributes to a window.
//   monthly → amount × months live
//   annual  → amount/12 × months live (spread, so a month view sees 1/12)
//   once    → amount if its date is inside the window
export function costInWindow(row, { windowStart, windowEnd }) {
  const amount = Number(row?.amount || 0)
  if (!(amount > 0)) return 0
  if (row.period === 'once') {
    const d = toDate(row.start_date)
    const ws = toDate(windowStart), we = toDate(windowEnd)
    if (!d || !ws || !we) return 0
    return d >= ws && d <= we ? amount : 0
  }
  const months = monthsLive({ start: row.start_date, end: row.end_date, windowStart, windowEnd })
  return row.period === 'annual' ? (amount / 12) * months : amount * months
}

// Straight-line monthly depreciation of a fixed_assets row, and how much of
// it falls in a window. Depreciation starts the month AFTER purchase (as the
// register does), stops when fully depreciated, at the end of useful life,
// or at disposal.
export function monthlyDepreciation(asset) {
  const cost = Number(asset?.cost_price || 0)
  const rate = Number(asset?.depreciation_rate || 0)
  if (!(cost > 0) || !(rate > 0)) return 0
  return (cost * rate) / 12
}

export function depreciationInWindow(asset, { windowStart, windowEnd }) {
  const per = monthlyDepreciation(asset)
  if (!per) return 0
  const p = toDate(asset.purchase_date)
  if (!p) return 0
  const cost = Number(asset.cost_price)
  const lifeMonths = asset.useful_life_years ? Number(asset.useful_life_years) * 12 : Infinity
  const fullMonths = Math.min(lifeMonths, Math.ceil(cost / per))       // months until fully written down
  const firstMonth = ym(p) + 1                                          // month after purchase
  const lastByLife = firstMonth + fullMonths - 1
  const disposal = toDate(asset.disposal_date)
  const last = disposal ? Math.min(lastByLife, ym(disposal)) : lastByLife
  const ws = toDate(windowStart), we = toDate(windowEnd)
  if (!ws || !we) return 0
  const from = Math.max(firstMonth, ym(ws))
  const to = Math.min(last, ym(we))
  const months = Math.max(0, to - from + 1)
  return Math.min(per * months, cost)
}

// Everything above for one vehicle in one window, split so the Cost Summary
// can show where the money goes.
export function runningCostsFor({ vehicleId, costRows = [], assets = [], windowStart, windowEnd }) {
  const mine = costRows.filter((r) => r.vehicle_id === vehicleId)
  const recurring = mine.filter((r) => r.period !== 'once').reduce((s, r) => s + costInWindow(r, { windowStart, windowEnd }), 0)
  const oneOff = mine.filter((r) => r.period === 'once').reduce((s, r) => s + costInWindow(r, { windowStart, windowEnd }), 0)
  const depreciation = assets.filter((a) => a.fleet_id === vehicleId).reduce((s, a) => s + depreciationInWindow(a, { windowStart, windowEnd }), 0)
  const byKind = {}
  for (const r of mine) {
    const v = costInWindow(r, { windowStart, windowEnd })
    if (v) byKind[r.kind] = (byKind[r.kind] || 0) + v
  }
  return { recurring: r2(recurring), oneOff: r2(oneOff), depreciation: r2(depreciation), byKind }
}

const r2 = (n) => Math.round(n * 100) / 100
