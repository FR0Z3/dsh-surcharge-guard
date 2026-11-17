/**
 * Render tests for the settings page.
 *
 * The page is the part that cannot be verified without a logged-in browser, and
 * a component that throws blanks its whole slot entry. These tests mount it with
 * a stubbed `fetch` and assert what actually reaches the screen.
 *
 * `client.js` is a browser artifact: it expects `window.__ModuleLoader__`. The
 * shim below captures the factory so the component can be rendered in Node.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const React = require('react')
const TestRenderer = require('react-test-renderer')

// ---- module loader shim ----------------------------------------------------

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
const clientModule = factory(name => (name === 'react' ? React : undefined))
const Page = clientModule.__page

afterEach(() => {
  delete globalThis.fetch
})

/** Flush pending promises so the mount effects' fetches resolve. */
async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    await TestRenderer.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }
}

/** Every string rendered under a JSON tree. */
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
    // A controlled <input> keeps its text in `value`, not in children.
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

/** Replace `fetch` with a recorder answering the three plugin routes. */
function stubFetch(bodies) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    const key = new URL(String(url), 'http://localhost').pathname.split('/').pop()
    const entry = bodies[key]
    if (entry === undefined) throw new Error(`unexpected route ${String(url)}`)
    const body = typeof entry === 'function' ? entry(init, calls) : entry
    return { ok: body.ok !== false, status: body.ok === false ? 500 : 200, json: async () => body }
  }
  return calls
}

const stateBody = {
  ok: true,
  writable: true,
  families: [
    { id: 'gpt', surchargeAtTokens: 272000 },
    { id: 'gemini', surchargeAtTokens: 200000 },
    { id: 'grok', surchargeAtTokens: 200000 },
  ],
  config: {
    enabled: true,
    rules: [{ provider: 'codex', model: 'gpt-6.1-sol', surchargeAtTokens: 272000, enabled: true }],
    safetyMarginTokens: 20000,
    retainRatio: 0.16,
    maxAttempts: 2,
  },
}

const modelsBody = {
  ok: true,
  models: [
    { provider: 'codex', providerName: 'Codex', model: 'gpt-6.1-sol', name: 'GPT 6.1 Sol', contextWindow: 450000, family: 'gpt' },
    { provider: 'codex', providerName: 'Codex', model: 'gpt-6-astra', name: 'GPT 6 Astra', contextWindow: 1050000, family: 'gpt' },
    { provider: 'gem', providerName: 'Gem', model: 'gemini-3-pro', name: 'Gemini 3 Pro', contextWindow: 1000000, family: 'gemini' },
    { provider: 'x', providerName: 'X', model: 'grok-4', name: 'Grok 4', contextWindow: 1000000, family: 'grok' },
    { provider: 'd', providerName: 'DeepSeek', model: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', family: null },
  ],
}

/** Key-echoing translator, so assertions name keys rather than English copy. */
const t = key => key

/** Mount the page against stubbed routes. */
async function mount(overrides = {}) {
  const calls = stubFetch({ state: stateBody, models: modelsBody, config: { ok: true, config: stateBody.config }, ...overrides })
  let root
  await TestRenderer.act(async () => {
    root = TestRenderer.create(React.createElement(Page, { t }))
  })
  await settle()
  return { root, calls }
}

test('renders the rule table with the model, its line and its trigger point', async () => {
  const { root } = await mount()
  const text = textsOf(root.toJSON())

  assert.ok(text.includes('gpt-6.1-sol'), 'model id is shown')
  assert.ok(text.includes('272K'), 'the line is shown')
  // 272000 - 20000 margin = 252000 -> "252K"
  assert.ok(text.includes('252K'), `trigger point is shown (saw: ${text.join(' | ')})`)
  // The window is labelled with its column key, so match the whole cell.
  assert.ok(
    text.some(entry => entry.includes('colWindow') && entry.includes('450K')),
    `the context window is shown (saw: ${text.join(' | ')})`,
  )
})

test('renders one quick-add button per family, counting matches', async () => {
  const { root } = await mount()
  const text = textsOf(root.toJSON())
  const buttons = findByProp(root.toJSON(), props => typeof props.onClick === 'function')
    .map(node => textsOf(node).join(''))

  const gpt = buttons.find(label => label.includes('addFamily'))
  assert.ok(gpt, 'a family button exists')
  assert.ok(gpt.endsWith('(2)'), `GPT button counts the 2 GPT models (got ${gpt})`)
  assert.ok(text.length > 0)
})

test('clicking a family button posts one rule per matching model', async () => {
  const { root, calls } = await mount()
  const button = findByProp(root.toJSON(), (props, node) => (
    typeof props.onClick === 'function'
    && textsOf(node).join('').includes('addFamily')
    && textsOf(node).join('').endsWith('(2)')
  ))[0]
  assert.ok(button, 'the GPT family button is found')

  const before = calls.filter(call => call.init?.method === 'POST').length
  await TestRenderer.act(async () => { button.props.onClick() })
  await settle()

  const posts = calls.filter(call => call.init?.method === 'POST')
  assert.equal(posts.length, before + 1, 'exactly one save is posted')
  const sent = JSON.parse(posts.at(-1).init.body)
  // gpt-6.1-sol already has a rule, so only gpt-6-astra is new: 2 rules total.
  assert.equal(sent.rules.length, 2, 'the existing rule is kept and the missing GPT model is added')
  assert.deepEqual(
    sent.rules.map(rule => rule.model).sort(),
    ['gpt-6-astra', 'gpt-6.1-sol'],
  )
  assert.equal(sent.rules.every(rule => rule.surchargeAtTokens === 272000), true)
})

test('saving posts a JSON body with the JSON content type', async () => {
  const { root, calls } = await mount()
  const toggle = findByProp(root.toJSON(), props => props.role === 'switch')[0]
  assert.ok(toggle, 'the master toggle renders')

  await TestRenderer.act(async () => { toggle.props.onClick() })
  await settle()

  const post = calls.filter(call => call.init?.method === 'POST').at(-1)
  assert.ok(post, 'a save was posted')
  assert.equal(post.init.headers['content-type'], 'application/json')
  assert.equal(JSON.parse(post.init.body).enabled, false, 'the toggle flips the value')
})

test('typing in a threshold field does not save per keystroke', async () => {
  const { root, calls } = await mount()
  const input = findByProp(root.toJSON(), props => (
    props['aria-label'] === 'colLine gpt-6.1-sol'
  ))[0]
  assert.ok(input, 'the threshold input renders')

  // Type three characters without committing; each must stay local state.
  await TestRenderer.act(async () => {
    input.props.onFocus()
    input.props.onChange({ target: { value: '2' } })
    input.props.onChange({ target: { value: '27' } })
    input.props.onChange({ target: { value: '270' } })
  })
  await settle()

  assert.equal(
    calls.filter(call => call.init?.method === 'POST').length,
    0,
    'no save while typing',
  )

  // Committing on blur posts exactly one save with the parsed value. Re-query
  // between events: a controlled input re-renders, so the committed closure must
  // come from the updated node, exactly as a browser would drive it.
  const field = () => findByProp(root.toJSON(), props => props['aria-label'] === 'colLine gpt-6.1-sol')[0]
  await TestRenderer.act(async () => { field().props.onChange({ target: { value: '300K' } }) })
  await TestRenderer.act(async () => { field().props.onBlur() })
  await settle()

  const posts = calls.filter(call => call.init?.method === 'POST')
  assert.equal(posts.length, 1, 'one save on commit')
  assert.equal(JSON.parse(posts[0].init.body).rules[0].surchargeAtTokens, 300000)
})

test('reports a load failure instead of rendering an empty page', async () => {
  await mount({ state: { ok: false, error: 'boom' } })
  // The mount helper already settled; rebuild so the failed body is used.
  const calls = stubFetch({ state: { ok: false, error: 'boom' }, models: modelsBody })
  let root
  await TestRenderer.act(async () => {
    root = TestRenderer.create(React.createElement(Page, { t }))
  })
  await settle()
  const text = textsOf(root.toJSON()).join(' ')
  assert.ok(text.includes('loadFailed'), `failure is surfaced (saw: ${text})`)
  assert.ok(calls.length > 0)
})

test('shows the not-writable notice and disables the toggle', async () => {
  const calls = stubFetch({
    state: { ...stateBody, writable: false },
    models: modelsBody,
  })
  let root
  await TestRenderer.act(async () => {
    root = TestRenderer.create(React.createElement(Page, { t }))
  })
  await settle()
  const text = textsOf(root.toJSON()).join(' ')
  assert.ok(text.includes('notWritable'), 'the notice is shown')
  const toggle = findByProp(root.toJSON(), props => props.role === 'switch')[0]
  assert.equal(toggle.props.disabled, true, 'the toggle is disabled')
  assert.ok(calls.length > 0)
})
