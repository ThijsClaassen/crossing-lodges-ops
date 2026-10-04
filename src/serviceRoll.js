// "Service done" on a workshop invoice (2026-10-04, task #548). Thijs: "When
// adding an invoice for a car that is due for service, add a tick box — was
// service done? Then automatically also update the service due to the next
// (so 10.000 interval or date, whatever is selected)."
//
// The next service is never stored; vehicleStatus() works it out from the
// LAST service (date and km) plus the vehicle's own interval (months and/or
// km). So "service done" means: last service = this invoice's date and the
// odometer at the time. Whichever interval the vehicle uses then moves the
// due date / due km forward by itself. Pure, so tools/service_roll_test.mjs
// runs it directly.

// The app stores dates as DD/MM/YYYY text.
const pad = (n) => String(n).padStart(2, '0')
function parseDate(s) {
  if (!s) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim())
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3])
  const p = String(s).split('/')
  if (p.length !== 3) return null
  const d = new Date(+p[2], +p[1] - 1, +p[0])
  return isNaN(d.getTime()) ? null : d
}
const toDMY = (d) => (d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : null)

// Does this vehicle have a service schedule at all?
export const hasServiceSchedule = (v) => !!v && (Number(v.service_interval_months) > 0 || Number(v.service_interval_km) > 0)

// The vehicle after a service on `date` (DD/MM/YYYY or ISO) at `km`.
// km may be blank: then the km side is left as it was (a date-only service
// still moves a date-based schedule).
export function applyServiceDone(vehicle, { date, km }) {
  const d = parseDate(date)
  const out = { ...vehicle }
  if (d) out.last_service_date = toDMY(d)
  const k = km === '' || km == null ? null : Number(km)
  if (k != null && Number.isFinite(k) && k > 0) out.last_service_km = k
  return out
}

// What the next service will be after `applyServiceDone` — for the line under
// the tick box, so the person sees what they are about to set.
export function nextServiceAfter(vehicle, { date, km }) {
  const v = applyServiceDone(vehicle, { date, km })
  const months = Number(v.service_interval_months) || 0
  const every = Number(v.service_interval_km) || 0
  let dueDate = null
  if (months > 0 && v.last_service_date) {
    const d = parseDate(v.last_service_date)
    if (d) { const n = new Date(d.getTime()); n.setMonth(n.getMonth() + months); dueDate = toDMY(n) }
  }
  const dueKm = every > 0 && v.last_service_km != null && v.last_service_km !== '' ? Number(v.last_service_km) + every : null
  return { dueDate, dueKm }
}

// Readable line: "Next service: 04/04/2027 or 95 000 km, whichever comes first".
export function nextServiceText({ dueDate, dueKm }) {
  const km = dueKm != null ? `${Math.round(dueKm).toLocaleString('en-ZA')} km` : null
  if (dueDate && km) return `Next service: ${dueDate} or ${km}, whichever comes first.`
  if (dueDate) return `Next service: ${dueDate}.`
  if (km) return `Next service: ${km}.`
  return 'This vehicle has no service interval set — set one under Fleet to get a next-service date.'
}
