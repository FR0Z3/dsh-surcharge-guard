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
 * A fake `ConfigForm`, the shape the shared service returns.
 *
 * It is a real store: `getSnapshot()` returns the SAME object until a write
 * replaces it, and `subscribe` notifies. That identity rule is what makes
 * `useSyncExternalStore` re-render exactly once per change instead of looping.
 */
function fakeForm(initial, { writable = true, status = 'ready' } = {}) {
  const value = { ...initial }
  const listeners = new Set()
  const writes = []
  let snapshot = { status, writable, value: { ...value }, base: undefined, user: undefined, revision: 1 }
  const publish = () => {
    snapshot = { ...snapshot, revision: snapshot.revision + 1, value: { ...value } }
    for (const listener of listeners) listener()
  }
  return {
    value,
    writes,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(field, next) {
      writes.push({ op: 'set', path: [field], value: next })
      value[field] = next
      publish()
      return Promise.resolve(true)
    },
    mutate(ops) {
      for (const op of ops) {
        writes.push(op)
        if (op.op === 'set') value[op.path[0]] = op.value
      }
      publish()
      return Promise.resolve(true)
    },
  }
}

/** A fake client context exposing only what the card reads. */
function fakeContext({ catalog, catalogs = true, forms, declared } = {}) {
  return {
    get(name) {
      if (name === 'configForms') {
        if (forms === undefined && declared === undefined) return undefined
        // Mirrors the service: `get` always answers a form, whose snapshot says
        // whether that namespace is actually served.
        const table = { ...(forms ?? {}) }
        if (declared !== undefined) table['include:llm-pi-ai'] = declaredForm(declared)
        return { get: entryId => table[entryId] ?? unservedForm() }
      }
      if (name === 'remote.session' || name === 'remote') {
        if (!catalogs) return undefined
        return { modelCatalog: async () => ({ ok: true, value: catalog }) }
      }
      return undefined
    },
  }
}

/** A form exposing a provider document, as `llm-pi-ai` does. */
function declaredForm(providers) {
  const snapshot = { status: 'ready', writable: false, value: { providers }, base: undefined, user: undefined, revision: 1 }
  return {
    state: snapshot,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: async () => false,
    mutate: async () => false,
  }
}

/** A form for a namespace the host does not serve. */
function unservedForm() {
  const snapshot = { status: 'unavailable', writable: false, value: undefined, base: undefined, user: undefined, revision: undefined }
  return { getSnapshot: () => snapshot, subscribe: () => () => {}, set: async () => false, mutate: async () => false }
}

const defaultConfig = {
  enabled: true,
  rules: [{ provider: 'codex', model: 'gpt-6.1-sol', surchargeAtTokens: 272000, enabled: true }],
  safetyMarginTokens: 20000,
  retainRatio: 0.16,
  maxAttempts: 2,
}

/**
 * The real `ModelCatalog` shape the Host answers: `{ groups, failures, ... }`
 * with `{ id, name, models }` per group. Provider model metadata carries no
 * context window, so the fixture has none either.
 */
const defaultCatalog = {
  default: { provider: 'codex', model: 'gpt-6.1-sol' },
  routableProviders: ['codex', 'gem', 'x', 'd'],
  groups: [
    { id: 'codex', name: 'Codex', models: [
      { id: 'gpt-6.1-sol', name: 'GPT 6.1 Sol' },
      { id: 'gpt-6-astra', name: 'GPT 6 Astra' },
    ] },
    { id: 'gem', name: 'Gem', models: [{ id: 'gemini-3-pro', name: 'Gemini 3 Pro' }] },
    { id: 'x', name: 'X', models: [{ id: 'grok-4', name: 'Grok 4' }] },
    { id: 'd', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }] },
  ],
  failures: [],
}

/** Key-echoing translator, so assertions name keys rather than copy. */
const t = key => key

/** Mount the card. */
async function mount(overrides = {}) {
  const form = overrides.form ?? fakeForm(overrides.config ?? defaultConfig, overrides.formOptions)
  const ctx = overrides.ctx ?? fakeContext({
    catalog: overrides.catalog ?? defaultCatalog,
    catalogs: overrides.catalogs,
    declared: overrides.declared,
  })
  let root
  await TestRenderer.act(async () => {
    root = TestRenderer.create(React.createElement(Panel, {
      t,
      ctx,
      form: overrides.noForm === true ? undefined : form,
    }))
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
  // The catalog carries no context window, so the card must not invent one.
  assert.equal(text.some(entry => entry.includes('colWindow')), false)
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
  assert.equal(form.writes[0].path[0], 'rules')
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

  assert.deepEqual(form.writes.at(-1), { op: 'set', path: ['enabled'], value: false })
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
  assert.equal(form.writes[0].path[0], 'rules')
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
  assert.deepEqual(form.writes.at(-1), { op: 'set', path: ['rules'], value: [] })
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

// ---- the list one-liner ----------------------------------------------------

const Summary = clientModule.__summary

/** Mount the summary view. */
async function mountSummary(form) {
  let root
  await TestRenderer.act(async () => {
    root = TestRenderer.create(React.createElement(Summary, { t, form }))
  })
  await settle()
  return root
}

test('the summary view is a one-liner, not the whole form', async () => {
  const root = await mountSummary(fakeForm(defaultConfig))
  const text = textsOf(root.toJSON()).join(' ')
  assert.equal(text, 'summaryOn', `only the one-liner renders (saw: ${text})`)
  assert.equal(text.includes('colLine'), false, 'no table leaks into the list row')
})

test('the summary counts only enabled rules', async () => {
  const form = fakeForm({
    ...defaultConfig,
    rules: [
      { provider: 'p', model: 'a', surchargeAtTokens: 1, enabled: true },
      { provider: 'p', model: 'b', surchargeAtTokens: 1, enabled: false },
    ],
  })
  const root = await mountSummary(form)
  assert.equal(textsOf(root.toJSON()).join(' '), 'summaryOn')
})

test('the summary names the off and empty states', async () => {
  const off = await mountSummary(fakeForm({ ...defaultConfig, enabled: false }))
  assert.equal(textsOf(off.toJSON()).join(' '), 'summaryOff')

  const empty = await mountSummary(fakeForm({ ...defaultConfig, rules: [] }))
  assert.equal(textsOf(empty.toJSON()).join(' '), 'summaryNoRules')
})

test('the card is what the page view renders', async () => {
  const form = fakeForm(defaultConfig)
  let root
  await TestRenderer.act(async () => {
    root = TestRenderer.create(React.createElement(clientModule.__page, { t, ctx: fakeContext({ catalog: defaultCatalog }), form }))
  })
  await settle()
  const text = textsOf(root.toJSON()).join(' ')
  assert.ok(text.includes('colLine'), 'the page view carries the table')
})

// ---- namespace resolution --------------------------------------------------

/**
 * The bug these cover: `configForms` keys a form by its LOADER ENTRY ID, and a
 * bundle composed through `dsh.profile.bundles` mounts under an `include:`
 * wrapper. Looking up the bare package name found an unserved namespace, so the
 * card reported "not writable" while the guard was fine.
 */
test('finds the served form behind the include: spelling', async () => {
  const form = fakeForm(defaultConfig)
  const ctx = fakeContext({ catalog: defaultCatalog, forms: { 'include:dsh-surcharge-guard': form } })
  let root
  await TestRenderer.act(async () => {
    root = TestRenderer.create(React.createElement(Panel, { t, ctx }))
  })
  await settle()

  const text = textsOf(root.toJSON()).join(' ')
  assert.equal(text.includes('notWritable'), false, 'a served namespace is writable')
  assert.ok(text.includes('gpt-6.1-sol'), 'the table renders from that namespace')

  // And a write lands on the served form, not a fresh unserved handle.
  const toggle = findByProp(root.toJSON(), props => props.role === 'switch')[0]
  await TestRenderer.act(async () => { toggle.props.onClick() })
  await settle()
  assert.equal(form.writes.length, 1)
})

test('prefers the bare package name when the host serves that instead', async () => {
  const bare = fakeForm(defaultConfig)
  const ctx = fakeContext({ catalog: defaultCatalog, forms: { 'dsh-surcharge-guard': bare } })
  let root
  await TestRenderer.act(async () => {
    root = TestRenderer.create(React.createElement(Panel, { t, ctx }))
  })
  await settle()
  const text = textsOf(root.toJSON()).join(' ')
  assert.equal(text.includes('notWritable'), false)
  assert.ok(text.includes('gpt-6.1-sol'))
})

test('reports not-writable when no candidate namespace is served', async () => {
  const ctx = fakeContext({ catalog: defaultCatalog, forms: {} })
  let root
  await TestRenderer.act(async () => {
    root = TestRenderer.create(React.createElement(Panel, { t, ctx }))
  })
  await settle()
  const text = textsOf(root.toJSON()).join(' ')
  assert.ok(text.includes('notWritable'), `the refusal is surfaced (saw: ${text})`)
})

test('renders without any configForms service at all', async () => {
  const ctx = fakeContext({ catalog: defaultCatalog, forms: undefined })
  let root
  await TestRenderer.act(async () => {
    root = TestRenderer.create(React.createElement(Panel, { t, ctx }))
  })
  await settle()
  const text = textsOf(root.toJSON()).join(' ')
  assert.ok(text.includes('notWritable'))
})

// ---- catalog shape ---------------------------------------------------------

/**
 * The bug these cover: the Host answers `ModelCatalog` with `groups`, while the
 * card parsed a `providers` key. The list was always empty, and the page told
 * the user to configure a provider that was already configured.
 */
test('reads models out of the catalog groups shape', async () => {
  const { root } = await mount()
  const labels = findByProp(root.toJSON(), props => typeof props.onClick === 'function')
    .map(node => textsOf(node).join(''))
  const gpt = labels.find(label => label.includes('addFamily') && label.includes('(2)'))
  assert.ok(gpt, `the groups shape yields both GPT models (saw: ${labels.join(' | ')})`)
})

test('names the providers that failed instead of denying they exist', async () => {
  const ctx = {
    get(name) {
      if (name === 'remote.session' || name === 'remote') {
        return {
          modelCatalog: async () => ({
            ok: true,
            value: {
              groups: [],
              failures: [{ id: 'codex', name: 'Codex', message: 'unauthorized' }],
            },
          }),
        }
      }
      return undefined
    },
  }
  const { root } = await mount({ ctx })
  const text = textsOf(root.toJSON()).join(' ')
  assert.ok(text.includes('noModels'), 'the empty state is stated')
  assert.ok(text.includes('unauthorized'), `the provider failure is named (saw: ${text})`)
})

test('an empty catalog with no failures stays a plain empty state', async () => {
  const ctx = {
    get(name) {
      if (name === 'remote.session' || name === 'remote') {
        return { modelCatalog: async () => ({ ok: true, value: { groups: [], failures: [] } }) }
      }
      return undefined
    },
  }
  const { root } = await mount({ ctx })
  const text = textsOf(root.toJSON()).join(' ')
  assert.ok(text.includes('noModels'))
  assert.equal(text.includes('undefined'), false, 'no undefined leaks into the copy')
})

// ---- declared vs live models -----------------------------------------------

/**
 * The bug these cover: the live catalog lists only providers whose adapter is
 * registered. A provider configured without a usable key is absent from it
 * entirely, so the card said "no models" for models the user could see in
 * Settings -> Models. The settings document also carries the context window,
 * which the live catalog omits.
 */
const declaredProviders = {
  'codex-everywhere-plus-pool': {
    displayName: 'Codex Plus',
    models: [
      { id: 'gpt-6.1-sol', name: 'GPT 6.1 Sol', contextWindow: 450000, maxTokens: 128000 },
      { id: 'gpt-6-astra', name: 'GPT 6 Astra', contextWindow: 1050000, maxTokens: 128000 },
    ],
  },
  'gem-pool': { models: [{ id: 'gemini-3-pro', contextWindow: 1000000 }] },
}

test('finds declared models whose provider is not registered', async () => {
  // The live catalog is empty: every provider is dormant.
  const ctx = fakeContext({
    declared: declaredProviders,
    catalog: { groups: [], failures: [] },
  })
  const { root } = await mount({ ctx })
  const labels = findByProp(root.toJSON(), props => typeof props.onClick === 'function')
    .map(node => textsOf(node).join(''))
  assert.ok(
    labels.some(label => label.includes('addFamily') && label.includes('(2)')),
    `both declared GPT models are offered (saw: ${labels.join(' | ')})`,
  )
})

test('the declared source restores the context window', async () => {
  const ctx = fakeContext({ declared: declaredProviders, catalog: { groups: [], failures: [] } })
  const { root } = await mount({
    ctx,
    config: {
      ...defaultConfig,
      rules: [{ provider: 'codex-everywhere-plus-pool', model: 'gpt-6.1-sol', surchargeAtTokens: 272000, enabled: true }],
    },
  })
  const text = textsOf(root.toJSON()).join(' ')
  assert.ok(text.includes('450K'), `the window is shown (saw: ${text})`)
  assert.ok(text.includes('dormant'), 'and the inactive provider is named as such')
})

test('a live model carries no dormant marker', async () => {
  const ctx = fakeContext({
    declared: declaredProviders,
    catalog: {
      groups: [{ id: 'codex-everywhere-plus-pool', name: 'Codex Plus', models: [{ id: 'gpt-6.1-sol', name: 'GPT 6.1 Sol' }] }],
      failures: [],
    },
  })
  const { root } = await mount({
    ctx,
    config: {
      ...defaultConfig,
      rules: [{ provider: 'codex-everywhere-plus-pool', model: 'gpt-6.1-sol', surchargeAtTokens: 272000, enabled: true }],
    },
  })
  const text = textsOf(root.toJSON()).join(' ')
  assert.equal(text.includes('dormant'), false, 'a routable model is not marked dormant')
  assert.ok(text.includes('450K'), 'the window still comes from the declared side')
})

test('the live catalog and declared config merge without duplicating a model', async () => {
  const ctx = fakeContext({
    declared: declaredProviders,
    catalog: {
      groups: [{ id: 'codex-everywhere-plus-pool', name: 'Codex Plus', models: [{ id: 'gpt-6.1-sol', name: 'GPT 6.1 Sol' }] }],
      failures: [],
    },
  })
  const { root } = await mount({ ctx })
  const labels = findByProp(root.toJSON(), props => typeof props.onClick === 'function')
    .map(node => textsOf(node).join(''))
  // Two distinct GPT ids: gpt-6.1-sol appears in both sources but counts once.
  assert.ok(labels.some(label => label.includes('(2)')), `no duplicate rows (saw: ${labels.join(' | ')})`)
})

// ---- a write must reach the screen -----------------------------------------

/**
 * The bug these cover: the card read the form snapshot but never subscribed to
 * it. A write reached the Host, the rule was saved, and the table below stayed
 * empty because nothing re-rendered. Saving something the user cannot see is
 * indistinguishable from not saving at all.
 */
test('adding a family shows the new rules in the table immediately', async () => {
  const { root, form } = await mount({
    config: { ...defaultConfig, rules: [] },
  })
  assert.equal(textsOf(root.toJSON()).join(' ').includes('gpt-6.1-sol'), false, 'starts empty')

  const button = findByProp(root.toJSON(), (props, node) => (
    typeof props.onClick === 'function' && textsOf(node).join('').endsWith('(2)')
  ))[0]
  await TestRenderer.act(async () => { button.props.onClick() })
  await settle()

  assert.equal(form.writes.length, 1, 'the write was issued')
  const text = textsOf(root.toJSON()).join(' ')
  assert.ok(text.includes('gpt-6.1-sol'), `the first rule appeared (saw: ${text})`)
  assert.ok(text.includes('gpt-6-astra'), 'and the second one too')
})

test('toggling a rule repaints its state', async () => {
  const { root } = await mount()
  const toggle = () => findByProp(root.toJSON(), (props, node) => (
    typeof props.onClick === 'function' && textsOf(node).join('') === 'off'
  ))[0]
  assert.ok(toggle(), 'the per-rule off control renders')

  await TestRenderer.act(async () => { toggle().props.onClick() })
  await settle()

  const text = textsOf(root.toJSON()).join(' ')
  // The row's action now offers the opposite verb.
  assert.ok(text.includes('on'), `the rule repainted as disabled (saw: ${text})`)
})

test('removing the only rule returns the empty state', async () => {
  const { root } = await mount()
  assert.ok(textsOf(root.toJSON()).join(' ').includes('gpt-6.1-sol'))

  const remove = findByProp(root.toJSON(), (props, node) => (
    typeof props.onClick === 'function' && textsOf(node).join('') === 'remove'
  ))[0]
  await TestRenderer.act(async () => { remove.props.onClick() })
  await settle()

  const text = textsOf(root.toJSON()).join(' ')
  assert.equal(text.includes('gpt-6.1-sol'), false, 'the row is gone')
  assert.ok(text.includes('rulesEmpty'), 'and the empty state is shown')
})

test('a refused write is reported instead of looking saved', async () => {
  const form = fakeForm({ ...defaultConfig, rules: [] })
  form.set = () => Promise.resolve(false)
  form.mutate = () => Promise.resolve(false)
  const { root } = await mount({ form })

  const button = findByProp(root.toJSON(), (props, node) => (
    typeof props.onClick === 'function' && textsOf(node).join('').endsWith('(2)')
  ))[0]
  await TestRenderer.act(async () => { button.props.onClick() })
  await settle()

  const text = textsOf(root.toJSON()).join(' ')
  assert.ok(text.includes('saveFailed'), `the refusal is surfaced (saw: ${text})`)
})

test('repaints when the form publishes without any prop change', async () => {
  // This is the regression that matters: a write reaches the Host, the store
  // publishes, and only a SUBSCRIPTION can bring that change to the screen.
  // Driving the write outside React removes every other reason to re-render.
  const form = fakeForm({ ...defaultConfig, rules: [] })
  const { root } = await mount({ form })
  assert.equal(textsOf(root.toJSON()).join(' ').includes('gpt-6.1-sol'), false)

  await TestRenderer.act(async () => {
    await form.set('rules', [
      { provider: 'codex', model: 'gpt-6.1-sol', surchargeAtTokens: 272000, enabled: true },
    ])
  })
  await settle()

  const text = textsOf(root.toJSON()).join(' ')
  assert.ok(text.includes('gpt-6.1-sol'), `the published rule reached the table (saw: ${text})`)
})
