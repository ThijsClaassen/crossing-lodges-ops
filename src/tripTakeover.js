// A vehicle left logged out (2026-10-04, task #549). Thijs: "What if someone
// forgot to log out a car, and someone else wants to log it in?"
//
// A trip with no closing reading means the vehicle is still out. When the next
// driver starts a trip on that vehicle, their opening odometer reading is the
// best reading there is for when the forgotten trip ended — so that trip is
// closed at it, with a note saying who closed it and why, and the new trip
// starts. The forgotten trip keeps its own driver, date and purpose; only its
// end reading and a note are added. Pure, so tools/trip_takeover_test.mjs runs
// it directly.

// The open trip on this vehicle, if any (the latest, should there be several).
export function openTripFor(trips, vehicleId) {
  if (!vehicleId) return null
  const open = (trips || []).filter((t) => t.vehicle_id === vehicleId && (t.end_km === null || t.end_km === undefined))
  if (!open.length) return null
  return open.sort((a, b) => String(b.trip_date || '').localeCompare(String(a.trip_date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')))[0]
}

// Can the open trip be closed at the new opening reading?
export function takeoverProblem(open, newStartKm) {
  if (!open) return null
  const s = Number(newStartKm)
  if (!(s >= 0) || newStartKm === '' || newStartKm == null) return 'Enter the opening odometer reading first — it also closes the earlier trip.'
  if (s < Number(open.start_km)) return `The opening reading can't be below ${Number(open.start_km).toLocaleString('en-ZA')} km, where ${open.driver_name || 'the last driver'} took it out.`
  return null
}

// The patch for the forgotten trip.
export function takeoverPatch(open, { newStartKm, newDriver, today }) {
  const note = `Not logged back in — closed at ${Number(newStartKm).toLocaleString('en-ZA')} km by ${newDriver || 'the next driver'} on ${today} when they took the vehicle.`
  return {
    end_km: Number(newStartKm),
    notes: open.notes ? `${open.notes} · ${note}` : note,
  }
}
