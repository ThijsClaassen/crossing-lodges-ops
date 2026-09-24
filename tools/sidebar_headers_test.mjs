// Sidebar section headers must not look like sidebar items.
//
// THE BUG (2026-09-24). Thijs: "the headers are now almost the same font and
// color as the other items, so not clearly to set them apart."
//
// He was right, and it was self-inflicted. The 2026-09-22 rail-contrast pass
// fixed a real problem — page tokens were being used on the dark navy rail and
// landing at 2.16:1 — by pointing a batch of sidebar selectors at
// --sidebar-muted. That batch included BOTH .nav-section and .nav-item, so the
// fix left headers and items the same colour. Each rule was defensible on its
// own; the pair was not, and nothing compared them.
//
// So this test asserts the RELATIONSHIP, not the values: headers and items
// must differ in colour, weight and size, and the three tiers (header, item,
// active item) must be three distinct colours.
//
// It also holds Ops and Maintenance to the same rule, because they are the two
// apps that render sections and a sidebar that differs between them is the
// thing Thijs asked to stop happening.
//
//   node tools/sidebar_headers_test.mjs
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OPS = join(HERE, '..')
const APPS = [
  { name: 'Ops', dir: OPS },
  { name: 'Maintenance', dir: join(OPS, 'crossing-lodges-maintenance') },
]

let passed = 0
const failures = []
const check = (name, cond, detail) =>
  cond ? passed++ : failures.push(`${name}${detail ? ` — ${detail}` : ''}`)

// Last declaration wins in CSS, so the EFFECTIVE value of a property is the
// last one across all rules for that selector. Reading only the first rule is
// how the override that caused this bug would have been missed.
const effective = (css, selector, prop) => {
  const re = new RegExp(`\\${selector}\\{([^}]*)\\}`, 'g')
  let value = null
  for (const m of css.matchAll(re)) {
    const hit = [...m[1].matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'g'))]
    if (hit.length) value = hit[hit.length - 1][1].trim()
  }
  return value
}

for (const app of APPS) {
  const themePath = join(app.dir, 'src', 'theme.js')
  const appPath = join(app.dir, 'src', 'App.jsx')
  if (!existsSync(themePath) || !existsSync(appPath)) {
    failures.push(`${app.name}: src not found at ${app.dir}`)
    continue
  }
  const css = readFileSync(themePath, 'utf8')
  const jsx = readFileSync(appPath, 'utf8')

  const headerColor = effective(css, '.nav-section', 'color')
  const itemColor = effective(css, '.nav-item', 'color')
  const activeColor = effective(css, '.nav-item.active', 'color')

  check(`${app.name}: header has a colour`, !!headerColor)
  check(`${app.name}: item has a colour`, !!itemColor)

  // THE ACTUAL REGRESSION. Not "is it muted" — is it the SAME as the item.
  check(
    `${app.name}: header colour differs from item colour`,
    headerColor && itemColor && headerColor !== itemColor,
    `both are ${headerColor}`,
  )
  check(
    `${app.name}: header, item and active item are three distinct colours`,
    new Set([headerColor, itemColor, activeColor].filter(Boolean)).size === 3,
    [headerColor, itemColor, activeColor].join(' / '),
  )

  // Colour alone is a weak signal on a dark rail; weight and size carry it too.
  const hw = parseInt(effective(css, '.nav-section', 'font-weight') || '0', 10)
  const iw = parseInt(effective(css, '.nav-item', 'font-weight') || '0', 10)
  check(`${app.name}: header is bolder than an item`, hw > iw, `${hw} vs ${iw}`)

  const hs = parseFloat(effective(css, '.nav-section', 'font-size') || '0')
  const is = parseFloat(effective(css, '.nav-item', 'font-size') || '0')
  check(`${app.name}: header is smaller than an item`, hs > 0 && is > 0 && hs < is, `${hs} vs ${is}`)

  check(
    `${app.name}: header is uppercase and letterspaced`,
    /text-transform:\s*uppercase/.test(css.match(/\.nav-section\{[^}]*\}/)?.[0] || '') &&
      /letter-spacing/.test(css.match(/\.nav-section\{[^}]*\}/)?.[0] || ''),
  )

  // The opacity multiplier that made the old headers faint must not return.
  const op = effective(css, '.nav-section', 'opacity')
  check(`${app.name}: header is not dimmed by opacity`, !op || parseFloat(op) === 1, op)

  // Divider above each group, suppressed on the first one.
  check(
    `${app.name}: groups are separated by a rule`,
    /border-top:\s*1px solid var\(--sidebar-line\)/.test(css.match(/\.nav-section\{[^}]*\}/)?.[0] || ''),
  )
  check(
    `${app.name}: the first header has no rule above it`,
    /\.nav-section\.first\{[^}]*border-top:\s*none/.test(css),
    'a hairline under the lodge picker reads as a double rule',
  )
  // Both renderers — desktop rail AND mobile sheet — must flag the first one,
  // or the sheet gets a stray divider that the rail does not.
  const flagged = [...jsx.matchAll(/nav-section\$\{si===0\?" first":""\}/g)].length
  check(
    `${app.name}: both nav renderers mark the first section`,
    flagged === 2,
    `${flagged} of 2`,
  )
}

// --- the two apps must agree ------------------------------------------------
{
  const rule = (dir) =>
    (readFileSync(join(dir, 'src', 'theme.js'), 'utf8').match(/\.nav-section\{[^}]*\}/g) || []).join('\n')
  check(
    'Ops and Maintenance share the same header styling',
    rule(APPS[0].dir) === rule(APPS[1].dir),
    'the sidebar must not differ between apps',
  )
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`)
  process.exit(1)
}
console.log('Sidebar headers are clearly distinct from items, in both apps.\n')
