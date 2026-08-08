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

export const LOCATIONS = [
  { id: 'ZC', name: 'Zebras Crossing' },
  { id: 'EC', name: 'Elephants Crossing' },
  { id: 'SC', name: 'Schamach' },
]
export const LOC_COLORS = { ZC: '#B8935A', EC: '#5B8CC4', SC: '#7BAE7F' }
