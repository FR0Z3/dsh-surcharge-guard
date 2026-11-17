/**
 * Host-half wiring tests.
 *
 * The Host half registers exactly one listener and owns no HTTP route: the card
 * lives on the plugin's own page in Plugins and writes through `configForms`,
 * so the settings surface cannot 404 (a route that failed to register once made
 * the page render with a permanent "read failed: HTTP 404").
 *
 * These tests drive `apply` with a fake Cordis context.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const mod = await import('../index.js')

/** A fake context recording listeners and effects. */
function fakeContext() {
  const listeners = []
  const effects = []
  const ctx = {
    get: () => undefined,
    on: (name, handler) => { listeners.push({ name, handler }); return () => {} },
    effect: (fn, label) => { effects.push(label); const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
    logger: { info: () => {}, warn: () => {} },
    fiber: { entry: { id: 'dsh-surcharge-guard' } },
  }
  return { ctx, listeners, effects }
}

const config = {
  enabled: true,
  rules: [{ provider: 'p', model: 'm', surchargeAtTokens: 272000, enabled: true }],
  safetyMarginTokens: 20000,
  retainRatio: 0.16,
  maxAttempts: 2,
}

test('registers a single pre-step listener and no web route', () => {
  const { ctx, listeners } = fakeContext()
  mod.apply(ctx, config)
  assert.equal(listeners.length, 1)
  assert.equal(listeners[0].name, 'agent/pre-step')
})

test('does not require webServer to activate', () => {
  const { ctx } = fakeContext()
  // `get` answers undefined for everything, exactly like a profile with no
  // web carrier; applying must still succeed.
  assert.doesNotThrow(() => mod.apply(ctx, config))
})

test('the listener always defers to the next handler', async () => {
  const { ctx, listeners } = fakeContext()
  mod.apply(ctx, config)
  const sentinel = { kind: 'enter', messages: [] }
  const result = await listeners[0].handler(
    {
      agent: {
        session: {
          requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
          seq: 1,
          surface: { nodes: [] },
          eventAt: () => undefined,
        },
      },
      signal: { aborted: false },
    },
    async () => sentinel,
  )
  assert.equal(result, sentinel, 'the guard never owns the step decision')
})

test('an unguarded model is ignored and the step proceeds', async () => {
  const { ctx, listeners } = fakeContext()
  mod.apply(ctx, config)
  const sentinel = { kind: 'enter', messages: [] }
  const result = await listeners[0].handler(
    {
      agent: {
        session: {
          requestHeader: () => ({ config: { provider: 'other', model: 'x' } }),
          seq: 0,
          surface: { nodes: [] },
          eventAt: () => undefined,
        },
      },
      signal: { aborted: false },
    },
    async () => sentinel,
  )
  assert.equal(result, sentinel)
})

test('a disabled guard does nothing at all', async () => {
  const { ctx, listeners } = fakeContext()
  mod.apply(ctx, { ...config, enabled: false })
  const sentinel = { kind: 'enter', messages: [] }
  const result = await listeners[0].handler(
    {
      agent: {
        session: {
          requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
          seq: 1,
          surface: { nodes: [] },
          eventAt: () => undefined,
        },
      },
      signal: { aborted: false },
    },
    async () => sentinel,
  )
  assert.equal(result, sentinel)
})

test('an aborted step is not touched', async () => {
  const { ctx, listeners } = fakeContext()
  mod.apply(ctx, config)
  const sentinel = { kind: 'enter', messages: [] }
  const result = await listeners[0].handler(
    {
      agent: {
        session: {
          requestHeader: () => { throw new Error('must not be called') },
          seq: 1,
          surface: { nodes: [] },
          eventAt: () => undefined,
        },
      },
      signal: { aborted: true },
    },
    async () => sentinel,
  )
  assert.equal(result, sentinel)
})
