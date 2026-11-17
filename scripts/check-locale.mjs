/**
 * Keep the Client bundle's inline dictionaries identical to `locale/*.json`.
 *
 * The Client half cannot read `locale/*.json` at runtime (it is a browser
 * artifact), so the strings are duplicated into `client.js`. `locale/*.json`
 * is what Plugin Manager reads for the bundle's title and description, and
 * this script is what stops the two copies from drifting.
 *
 * Run: node scripts/check-locale.mjs
 */
import { readFileSync } from 'node:fs'

/** Locales the plugin ships. */
const LOCALES = ['zh', 'en']

/** Words that only appear in `meta` and are therefore not UI strings. */
const META_KEYS = new Set(['meta'])

/** Extract the inline dictionary object for one locale from `client.js`. */
function inlineDictionary(source, locale) {
  const start = source.indexOf(`const ${locale} = {`)
  if (start < 0) throw new Error(`client.js has no inline "${locale}" dictionary`)
  // Walk braces so nested objects and braces inside strings cannot end it early.
  let depth = 0
  let index = source.indexOf('{', start)
  const from = index
  let inString = false
  let quote = ''
  let escaped = false
  for (; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) inString = false
      continue
    }
    if (char === '"' || char === "'" || char === '`') { inString = true; quote = char; continue }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return JSON.parse(source.slice(from, index + 1))
    }
  }
  throw new Error(`client.js inline "${locale}" dictionary is unterminated`)
}

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
let failed = false

/** Locale files are the source of truth for keys; compare in both directions. */
const uiKeys = Object.fromEntries(LOCALES.map(locale => {
  const file = JSON.parse(readFileSync(new URL(`../locale/${locale}.json`, import.meta.url), 'utf8'))
  return [locale, new Set(Object.keys(file).filter(key => !META_KEYS.has(key)))]
}))

for (const locale of LOCALES) {
  const inline = inlineDictionary(client, locale)
  const expected = uiKeys[locale]
  const actual = new Set(Object.keys(inline))

  for (const key of expected) {
    if (!actual.has(key)) {
      console.error(`missing in client.js "${locale}": ${key}`)
      failed = true
    }
  }
  for (const key of actual) {
    if (!expected.has(key)) {
      console.error(`extra in client.js "${locale}": ${key}`)
      failed = true
    }
  }
  const file = JSON.parse(readFileSync(new URL(`../locale/${locale}.json`, import.meta.url), 'utf8'))
  for (const [key, value] of Object.entries(file)) {
    if (META_KEYS.has(key)) continue
    if (typeof value !== 'string') continue
    if (inline[key] !== value) {
      console.error(`text differs in client.js "${locale}": ${key}`)
      console.error(`  locale: ${JSON.stringify(value)}`)
      console.error(`  client: ${JSON.stringify(inline[key])}`)
      failed = true
    }
  }
}

// Both locales must describe the same key set, or the UI half-renders in one.
const [first, ...rest] = LOCALES
for (const locale of rest) {
  for (const key of uiKeys[first]) {
    if (!uiKeys[locale].has(key)) {
      console.error(`locale/${locale}.json is missing key present in ${first}: ${key}`)
      failed = true
    }
  }
  for (const key of uiKeys[locale]) {
    if (!uiKeys[first].has(key)) {
      console.error(`locale/${locale}.json has key absent from ${first}: ${key}`)
      failed = true
    }
  }
}

if (failed) process.exit(1)
console.log(`locale OK: ${LOCALES.length} locales, ${uiKeys[first].size} UI keys each`)
