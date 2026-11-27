/**
 * Compile the TypeScript sources into the runtime JavaScript this package ships.
 *
 * DSH loads the Host entries through the package `exports` and the browser
 * fetches the Client entry as plain JavaScript, so the compiled `.js` files sit
 * committed at the package root next to their `src/*.ts` sources and stay the
 * files the exports point at; a checkout runs without a build step.
 *
 * Sucrase erases type syntax only (`disableESTransforms` keeps optional
 * chaining, nullish coalescing and every other modern construct as written),
 * which makes each emitted file the image of its source minus the type
 * annotations, so `git diff` on a compiled file shows exactly what was added.
 * Erasing an `as` expression leaves the space that preceded it behind, and the
 * sources carry no trailing whitespace, so the emitted text is
 * right-trimmed per line to keep compiled files byte-faithful. Declaration
 * files are type-only and never emit. TypeScript itself never emits;
 * `tsc -p tsconfig.json` is the type gate and runs in `pnpm check`.
 *
 * Run: node scripts/build.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { transform } from 'sucrase'

/** Every `src/<name>.ts` compiles to `<name>.js` at the package root. */
const names = readdirSync(new URL('../src', import.meta.url))
  .filter(name => name.endsWith('.ts') && !name.endsWith('.d.ts'))
  .map(name => name.slice(0, -3))

if (names.length === 0) {
  console.error('build: no TypeScript sources found under src/')
  process.exit(1)
}

for (const name of names) {
  const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
  const { code } = transform(source, {
    transforms: ['typescript'],
    disableESTransforms: true,
    filePath: `src/${name}.ts`,
  })
  const compiled = code.split('\n').map(line => line.replace(/[ \t]+$/, '')).join('\n')
  writeFileSync(new URL(`../${name}.js`, import.meta.url), compiled)
  console.log(`compiled src/${name}.ts → ${name}.js`)
}
