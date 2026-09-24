// Fuel costing: one price source, and implausible prices get flagged.
//
// THE BUG THIS EXISTS FOR (2026-09-24). The Cost Summary costed fuel at the
// real weighted-average price paid; the Vehicle Detail modal costed the SAME
// litres at a hardcoded R20.50/R21.50 left over from before #392. Thijs's
// Defender GV read R82,948.34 on one screen and R8,320.50 on the other.
//
// Neither screen was obviously broken. Both showed a tidy rand figure, and
// nothing said which price either was using — so the only way to notice was to
// open both and compare, which is exactly what happened, months later.
//
// Two things are pinned here:
//   1. There is ONE price source. The constants exist only as a fallback for a
//      company with no purchase history, and must not appear in any screen's
//      costing path.
//   2. A derived price that cannot be real is FLAGGED, not clamped and not
//      silently used. R204/litre inflates every vehicle by the same factor,
//      and a clamped price would hide that forever.
//
//   node tools/fuel_price_test.mjs
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8')

let passed = 0
const failures = []
const check = (name, cond, detail) =>
  cond ? passed++ : failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
const near = (a, b, tol = 0.01) => Math.abs(Number(a) - Number(b)) < tol

try {
  parse(src, { sourceType: 'module', plugins: ['jsx'] })
  check('App.jsx parses', true)
} catch (err) {
  console.log(`PARSE FAIL — ${err.message}`)
  process.exit(1)
}

// --- 1. ONE price source ---------------------------------------------------
//
// Read the two costing functions and assert neither carries its own price.
// Comments stripped before any of this is searched. The comment explaining
// the bug necessarily QUOTES the old constants, and a check that cannot tell
// an explanation from live code fails on its own documentation.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const detail = stripComments(
  src.slice(src.indexOf('function VehicleDetail('), src.indexOf('// ─── COST SUMMARY')),
)
check(
  'VehicleDetail no longer defines its own price constants',
  !/const\s+DIESEL_PRICE\s*=\s*[\d.]/.test(detail) &&
    !/const\s+PETROL_PRICE\s*=\s*[\d.]/.test(detail),
  'a literal price here is how the two screens drifted apart',
)
check(
  'VehicleDetail takes its prices from the shared function',
  /fuelPricesFrom\(/.test(detail),
  'it must use the same source as the Cost Summary',
)
check(
  'and there is no bare numeric price anywhere in its costing',
  // 20.5 / 21.5 appearing in this component at all means the old constants
  // came back under another name.
  !/\b2[01]\.5\b/.test(detail),
  detail.match(/\b2[01]\.5\b/g)?.join() || '',
)

// The fallbacks may exist exactly once each, at module level, and nowhere
// else — they are the no-purchase-history default, not a costing rate.
const fallbackUses = [...src.matchAll(/FALLBACK_(?:DIESEL|PETROL)_PRICE/g)].length
check(
  'the fallback constants are declared and used only in fuelPricesFrom',
  fallbackUses === 4, // 2 declarations + 2 uses
  `${fallbackUses} references`,
)

// --- 2. The warning is reachable from BOTH screens -------------------------
check('a FuelPriceWarning component exists', /function FuelPriceWarning\(/.test(src))
const usages = [...src.matchAll(/<FuelPriceWarning\b/g)].length
check(
  'and is rendered on both the Cost Summary and the Vehicle Detail',
  usages >= 2,
  `${usages} usage(s)`,
)
check(
  'the Vehicle Detail renders it',
  /<FuelPriceWarning/.test(detail),
  'the modal is where someone lands when a total looks wrong',
)

// --- 3. The maths, run for real -------------------------------------------
//
// fuelPricesFrom is exported and pure, so it can be executed rather than
// pattern-matched. Extracted with its two constants and the plausibility
// helper; nothing else in App.jsx is needed.
const slice = (from, to) => src.slice(src.indexOf(from), src.indexOf(to))
const mod = [
  slice('const FALLBACK_DIESEL_PRICE', 'export function fuelPricesFrom'),
  slice('export function fuelPricesFrom', '// The banner both fuel-costing screens show'),
].join('\n')
const F = await import('data:text/javascript;base64,' + Buffer.from(mod).toString('base64'))

const loc = (deliveries = [], purchases = []) => ({
  ZC: { dieselDeliveries: deliveries, petrolPurchases: purchases },
})

{
  // Weighted average, not a plain mean: 100L @ R20 and 900L @ R25 is R24.50,
  // not R22.50. Getting this wrong understates cost when the big deliveries
  // are the dear ones.
  const p = F.fuelPricesFrom(
    loc([{ litres: 100, pricePerLitre: 20 }, { litres: 900, pricePerLitre: 25 }]),
    ['ZC'],
  )
  check('diesel price is litre-weighted', near(p.diesel, 24.5), `${p.diesel}`)
  check('and is marked as actual', p.dieselIsActual === true)
  check('a sane price is not flagged', p.dieselSuspect === false)
}

{
  // No history: the fallback, and NOT flagged — warning a company that has
  // simply never logged a delivery would be noise.
  const p = F.fuelPricesFrom(loc(), ['ZC'])
  check('no deliveries falls back', near(p.diesel, 20.5), `${p.diesel}`)
  check('the fallback is not marked actual', p.dieselIsActual === false)
  check('and the fallback is never flagged as suspect', p.dieselSuspect === false)
}

{
  // THE ACTUAL FAILURE. A 1,000 L delivery with the R20,500 total typed into
  // the price-per-litre field, beside a normal one.
  const p = F.fuelPricesFrom(
    loc([{ litres: 1000, pricePerLitre: 20500 }, { litres: 1000, pricePerLitre: 20.5 }]),
    ['ZC'],
  )
  check(
    'a total typed into the price field wrecks the average',
    p.diesel > 10000,
    `${p.diesel}`,
  )
  check('and that price IS flagged', p.dieselSuspect === true, `${p.diesel}`)
  check(
    'but is NOT clamped to something believable',
    // Clamping would show a plausible wrong number forever instead of sending
    // someone to the delivery that caused it.
    p.diesel > 60,
    `${p.diesel}`,
  )
}

{
  // Boundaries. R60/L is high but conceivable; R61 is not.
  const at = (v) => F.fuelPricesFrom(loc([{ litres: 1, pricePerLitre: v }]), ['ZC']).dieselSuspect
  check('R60/litre is accepted', at(60) === false)
  check('R61/litre is flagged', at(61) === true)
  check('R5/litre is accepted', at(5) === false)
  check('R4/litre is flagged', at(4) === true)
}

{
  // Petrol is tracked independently — one bad diesel delivery must not flag
  // petrol, or the warning stops meaning anything.
  const p = F.fuelPricesFrom(
    loc([{ litres: 10, pricePerLitre: 9999 }], [{ litres: 10, pricePerLitre: 22 }]),
    ['ZC'],
  )
  check('diesel flagged', p.dieselSuspect === true)
  check('petrol not flagged by a diesel error', p.petrolSuspect === false, `${p.petrol}`)
}

{
  // Rows with a missing litre or price count toward neither the spend nor the
  // litres — a half-captured delivery must not drag the average anywhere.
  const p = F.fuelPricesFrom(
    loc([{ litres: 100, pricePerLitre: 20 }, { litres: 500, pricePerLitre: 0 }, { litres: 0, pricePerLitre: 25 }]),
    ['ZC'],
  )
  check('incomplete rows are ignored entirely', near(p.diesel, 20), `${p.diesel}`)
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`)
  process.exit(1)
}
console.log('Fuel costing has one price source, and an impossible price is flagged.\n')
