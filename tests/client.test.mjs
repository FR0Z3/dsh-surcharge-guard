/**
 * Render tests for the plugin's page card.
 *
 * The card is the part that cannot be verified without a logged-in browser, and
 * a component that throws blanks its whole slot entry. These mount it with a
 * fake `configForms` handle and a fake model catalog, and assert what actually
 * reaches the screen.
 *
 * `client.js` is a browser artifact: it expects `window.__ModuleLoader__`. The
 * shim below captures the factory so the card can be rendered in Node.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const React = require('react')
const TestRenderer = require('react-test-renderer')

let factory
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory: register }) {
      assert.equal(id, 'dsh-surcharge-guard')
      factory = register
    },
  },
}

await import('../client.js')
/** The module only needs React from the browser table. */
const clientModule = factory(name => (name === 'react' ? React : undefined))
const Panel = clientModule.__page

afterEach(() => {
  delete globalThis.fetch
})

/** Flush pending promises so effects' catalog loads resolve. */
async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    await TestRenderer.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }
}

/** Every string rendered under a JSON tree, including controlled input values. */
function textsOf(node, out = []) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) textsOf(child, out)
    return out
  }
  if (typeof node === 'object') {
    if (typeof node.props?.value === 'string') out.push(node.props.value)
    textsOf(node.children ?? [], out)
  }
  return out
}

/** Every node whose props satisfy `predicate`. */
function findByProp(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findByProp(child, predicate, out)
    return out
  }
  if (node.props !== undefined && predicate(node.props, node)) out.push(node)
  findByProp(node.children ?? [], predicate, out)
  return out
}

/**
 * A fake `configForms` handle.
 *
 * `getSnapshot()` must return the SAME object until something changes:
 * `useSyncExternalStore` compares by identity and re-renders forever when the
 * snapshot is rebuilt on every read.
 */
function fakeForm(initial, { writable = true, status = 'ready' } = {}) {
  const value = { ...initial }
  const listeners = new Set()
  const writes = []
  let snapshot = { status, writable, value: { ...value } }
  return {
    value,
    writes,
    set(field, next) {
      writes.push({ field, value: next })
      value[field] = next
      snapshot = { ...snapshot, value: { ...value } }
      for (const listener of listeners) listener()
      return Promise.resolve(true)
    },
    getSnapshot() {
      return snapshot
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {},
  }
}

/** A fake client context exposing only what the card reads. */
function fakeContext({ catalog, catalogs = true } = {}) {
  return {
    get(name) {
      if (name === 'configForms') return undefined
      if (name === 'remote.session' || name === 'remote') {
        if (!catalogs) return undefined
        return { modelCatalog: async () => ({ ok: true, value: catalog }) }
      }
      return undefined
    },
  }
}

const defaultConfig = {
  enabled: true,
  rules: [{ provider: 'codex', model: 'gpt-6.1-sol', surchargeAtTokens: 272000, enabled: true }],
  safetyMarginTokens: 20000,
  retainRatio: 0.16,
  maxAttempts: 2,
}

const defaultCatalog = [
  {
    provider: 'codex',
    providerName: 'Codex',
    models: [
      { id: 'gpt-6.1-sol', name: 'GPT 6.1 Sol', contextWindow: 450000 },
      { id: 'gpt-6-astra', name: 'GPT 6 Astra', contextWindow: 1050000 },
    ],
  },
  { provider: 'gem', providerName: 'Gem', models: [{ id: 'gemini-3-pro', name: 'Gemini 3 Pro', contextWindow: 1000000 }] },
  { provider: 'x', providerName: 'X', models: [{ id: 'grok-4', name: 'Grok 4', contextWindow: 1000000 }] },
  { provider: 'd', providerName: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }] },
]

/** Key-echoing translator, so assertions name keys rather than copy. */
const t = key => key

/** Mount the card. */
async function mount(overrides = {}) {
  const form = overrides.form ?? fakeForm(overrides.config ?? defaultConfig, overrides.formOptions)
  const ctx = overrides.ctx ?? fakeContext({ catalog: overrides.catalog ?? defaultCatalog, catalogs: overrides.catalogs })
  let root
  await TestRenderer.act(async () => {
    root = TestRenderer.create(React.createElement(Panel, { t, ctx, form: overrides.noForm === true ? undefined : form }))
  })
  await settle()
  return { root, form }
}

test('renders the rule table with the model, its line and its trigger point', async () => {
  const { root } = await mount()
  const text = textsOf(root.toJSON())
  assert.ok(text.includes('gpt-6.1-sol'), 'model id is shown')
  assert.ok(text.includes('272K'), 'the line is shown')
  // 272000 - 20000 margin = 252000 -> "252K"
  assert.ok(text.includes('252K'), `trigger point is shown (saw: ${text.join(' | ')})`)
  assert.ok(
    text.some(entry => entry.includes('colWindow') && entry.includes('450K')),
    `the context window is shown (saw: ${text.join(' | ')})`,
  )
})

test('renders one quick-add button per family, counting matches', async () => {
  const { root } = await mount()
  const labels = findByProp(root.toJSON(), props => typeof props.onClick === 'function')
    .map(node => textsOf(node).join(''))
  const gpt = labels.find(label => label.includes('addFamily') && label.includes('(2)'))
  assert.ok(gpt, `GPT button counts its 2 models (saw: ${labels.join(' | ')})`)
  assert.ok(labels.some(label => label.includes('(1)')), 'Gemini and Grok each count 1')
})

test('clicking a family button writes one rule per missing model', async () => {
  const { root, form } = await mount()
  const button = findByProp(root.toJSON(), (props, node) => (
    typeof props.onClick === 'function' && textsOf(node).join('').endsWith('(2)')
  ))[0]
  assert.ok(button, 'the GPT family button is found')

  await TestRenderer.act(async () => { button.props.onClick() })
  await settle()

  assert.equal(form.writes.length, 1, 'exactly one write')
  assert.equal(form.writes[0].field, 'rules')
  const written = form.writes[0].value
  // gpt-6.1-sol already has a rule, so only gpt-6-astra is added.
  assert.equal(written.length, 2)
  assert.equal(written.every(rule => rule.surchargeAtTokens === 272000), true)
  assert.ok(written.some(rule => rule.model === 'gpt-6-astra'))
})

test('the master toggle writes the boolean field', async () => {
  const { root, form } = await mount()
  const toggle = findByProp(root.toJSON(), props => props.role === 'switch')[0]
  assert.ok(toggle, 'the toggle renders')

  await TestRenderer.act(async () => { toggle.props.onClick() })
  await settle()

  assert.deepEqual(form.writes.at(-1), { field: 'enabled', value: false })
})

test('typing in a threshold field does not write per keystroke', async () => {
  const { root, form } = await mount()
  const field = () => findByProp(root.toJSON(), props => props['aria-label'] === 'colLine gpt-6.1-sol')[0]
  assert.ok(field(), 'the threshold input renders')

  await TestRenderer.act(async () => {
    field().props.onFocus()
    field().props.onChange({ target: { value: '2' } })
    field().props.onChange({ target: { value: '27' } })
    field().props.onChange({ target: { value: '270' } })
  })
  await settle()
  assert.equal(form.writes.length, 0, 'no write while typing')

  await TestRenderer.act(async () => { field().props.onChange({ target: { value: '300K' } }) })
  await TestRenderer.act(async () => { field().props.onBlur() })
  await settle()

  assert.equal(form.writes.length, 1, 'one write on commit')
  assert.equal(form.writes[0].field, 'rules')
  assert.equal(form.writes[0].value[0].surchargeAtTokens, 300000)
})

test('removing a rule writes the remaining list', async () => {
  const { root, form } = await mount()
  const remove = findByProp(root.toJSON(), (props, node) => (
    typeof props.onClick === 'function' && textsOf(node).join('') === 'remove'
  ))[0]
  assert.ok(remove, 'the remove control renders')
  await TestRenderer.act(async () => { remove.props.onClick() })
  await settle()
  assert.deepEqual(form.writes.at(-1), { field: 'rules', value: [] })
})

test('reports not-writable when no form is reachable', async () => {
  const { root } = await mount({ noForm: true })
  const text = textsOf(root.toJSON()).join(' ')
  assert.ok(text.includes('notWritable'), `the refusal is surfaced (saw: ${text})`)
})

test('still renders rules when the catalog is unavailable', async () => {
  const { root } = await mount({ catalogs: false })
  const text = textsOf(root.toJSON()).join(' ')
  assert.ok(text.includes('noCatalog'), 'the catalog gap is named')
  assert.ok(text.includes('gpt-6.1-sol'), 'the rules remain visible and editable')
})

test('reports a failed catalog read without losing the table', async () => {
  const ctx = {
    get(name) {
      if (name === 'remote.session' || name === 'remote') {
        return { modelCatalog: async () => ({ ok: false, error: { message: 'boom' } }) }
      }
      return undefined
    },
  }
  const { root } = await mount({ ctx })
  const text = textsOf(root.toJSON()).join(' ')
  assert.ok(text.includes('gpt-6.1-sol'), 'the table still renders')
  assert.ok(text.includes('scan'), 'the rescan control is offered')
})
