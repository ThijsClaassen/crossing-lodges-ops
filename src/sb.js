// Lightweight Supabase REST wrapper — same pattern as crossing-lodges-food
// and crossing-lodges-HR-Linen (small bundle, no SDK version dependency,
// plain fetch calls against PostgREST). Extracted out of App.jsx during the
// multi-tenant rebuild (2026-08-08) so it can be shared with the new
// Login.jsx/SetPassword.jsx/CompanyContext.jsx without a circular import.
//
// Points at the SAME Supabase project as Finance Dashboard/Food Stock/
// HR-Linen so they all share one database.
//
// Note this app's select() takes a raw PostgREST filter STRING (e.g.
// "role=eq.admin"), not a filters object like Food Stock/HR-Linen's sb.js —
// kept as-is rather than changed to match, to avoid rewriting every call
// site's calling convention during this migration.
//
// Made session-aware 2026-08-08 (Ops 3b of the multi-tenant rebuild):
// headers() now reads the real Supabase Auth session and sends the user's
// own access token instead of only the anon key, so RLS's auth.uid()
// resolves to the logged-in user rather than nobody. Same change already
// made in Food Stock's and HR/Linen's sb.js — and this time every call site
// was grepped and updated to `await headers()` from the start (see
// [[feedback-git-and-async-gotchas]] for why that step matters).

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js'

const SB_URL = SUPABASE_URL

async function headers(extra = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extra,
  }
}

export const sb = {
  async select(table, filters = '') {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?${filters}&order=created_at.desc`, {
      headers: await headers(),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },
  async insert(table, row) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify(row),
    })
    if (!res.ok) throw new Error(await res.text())
    const d = await res.json()
    return Array.isArray(d) ? d[0] : d
  },
  async upsert(table, row, onConflict) {
    const url = onConflict ? `${SB_URL}/rest/v1/${table}?on_conflict=${onConflict}` : `${SB_URL}/rest/v1/${table}`
    const res = await fetch(url, {
      method: 'POST',
      headers: await headers({ Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(row),
    })
    if (!res.ok) throw new Error(await res.text())
    const d = await res.json()
    return Array.isArray(d) ? d[0] : d
  },
  async delete(table, id) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: 'DELETE',
      headers: await headers(),
    })
    if (!res.ok) throw new Error(await res.text())
  },
  async patch(table, id, row) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: await headers(),
      body: JSON.stringify(row),
    })
    if (!res.ok) throw new Error(await res.text())
  },
  async deleteById(table, id) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: await headers(),
    })
    if (!res.ok) throw new Error(await res.text())
  },
}

// Lodges for the current company. Loaded from the shared `locations` table
// at login (see CompanyContext.jsx) instead of being hardcoded, so a second
// company's own lodges work without a code change (2026-08-26).
//
// Deliberately a MUTABLE module array rather than React state: this app
// already reads LOCATIONS synchronously in a number of places, some outside
// components, and converting every one to a hook would be a large change for
// no visible benefit today. CompanyContext fills this in BEFORE it renders
// any children, and refills it on company switch, so by the time anything
// reads it, it's correct. The array identity never changes — contents are
// replaced in place — so existing dependency arrays keep behaving as before.
export const LOCATIONS = []

// Only 'lodge' rows: the shared locations table also holds an 'overhead'
// (head office) row that the Finance Dashboard uses for non-lodge costs and
// that this app has never shown. Ordering is by created_at, not id, because
// the established display order is ZC, EC, SC — which alphabetical order
// would reshuffle to EC, SC, ZC.
export function setLocations(rows) {
  LOCATIONS.length = 0
  for (const r of rows || []) {
    if (r.type && r.type !== 'lodge') continue
    LOCATIONS.push({ id: r.id, name: r.name, type: r.type ?? null })
  }
  refreshLocColors()
}

// Per-lodge accent colours. Previously a hardcoded { ZC: ..., EC: ..., SC: ... }
// map; now assigned by position from a fixed palette so any lodge list works.
// The first three palette entries are the exact colours ZC/EC/SC have always
// had, and setLocations preserves their order, so nothing changes visually.
const LOC_PALETTE = ['#B8935A', '#5B8CC4', '#7BAE7F', '#C4795B', '#8C7BC4', '#C4B45B', '#5BC4B4']


export const LOC_COLORS = {}

function refreshLocColors() {
  for (const k of Object.keys(LOC_COLORS)) delete LOC_COLORS[k]
  LOCATIONS.forEach((l, i) => {
    LOC_COLORS[l.id] = LOC_PALETTE[i % LOC_PALETTE.length]
  })
}
