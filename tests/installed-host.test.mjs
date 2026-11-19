import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import * as guard from '../index.js'

const install = process.env.DSH_INSTALL_DIR
const useInstalled = Boolean(install) && (process.versions.electron !== undefined || !install.includes('.asar'))

/**
 * One real `agent/pre-step` waterfall over the installed packages.
 *
 * The summarizer is a subclass of the shipped backend, so the isolated
 * instance the guard mounts is exercised for real: it must start inside its
 * own realm, receive the configured route, and record it in `compaction/summary`.
 * Nothing here contacts a provider.
 */
async function run({ maxAttempts = 1 } = {}) {
  const require = createRequire(`${install}/package.json`)
  const load = name => import(pathToFileURL(require.resolve(`@deepseek-ai/${name}`)))
  const { Context } = await load('cordis')
  const { Session, SessionId } = await load('dsh-session')
  const { agentEvents } = await load('dsh-agent')
  const { createUserMessage } = await load('dsh-llm')
  const { BasicCompactionEngine } = await load('dsh-compaction-basic')
  const { TokenMeter } = await load('dsh-token-meter')
  const ctx = new Context()
  const id = `surcharge-guard-offline-${maxAttempts}-${Math.random().toString(16).slice(2, 8)}`
  const session = Session.create(SessionId(id))
  const route = { provider: 'offline', model: 'guarded' }
  const agent = { id: session.id, ctx, session, options: route }
  const signal = new AbortController().signal
  const summaries = []
  class OfflineCompaction extends BasicCompactionEngine {
    /** Record the route this instance was configured with, not the session's. */
    async summarize() {
      summaries.push({ provider: this.config.summarizationProvider, model: this.config.summarizationModel })
      const target = this.config.summarizationProvider
        ? { provider: this.config.summarizationProvider, model: this.config.summarizationModel }
        : route
      return { ...target, summary: [{ type: 'text', text: 'short checkpoint' }] }
    }
  }
  ctx.provide('llm', {
    imageRequestPricing() {},
    stream() { throw Error('This test must never call a model') },
  })
  ctx.provide('sessions', {})
  const meter = new TokenMeter(ctx)
  const engine = new OfflineCompaction(ctx.isolate('compaction'), { auto: false })
  assert.equal(ctx.get('compaction'), undefined)
  ctx.provide('agentPresets', { serviceFor: (owner, key) => owner === agent && key === 'compaction' ? engine : undefined })
  const user = text => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
  session.append('turn/start', { turn: 1 })
  // Visible history, deliberately without a first `request/header`.
  session.append('user/message', user('history content '.repeat(2500)), { surfaceOp: 'append' })
  session.append('user/message', user('keep recent '.repeat(100)), { surfaceOp: 'append' })
  return { ctx, session, route, agent, signal, summaries, meter, user, engine, agentEvents }
}

test('installed DSH: real waterfall, token meter and summary transaction', { skip: !useInstalled }, async () => {
  const { ctx, session, route, agent, signal, summaries, meter, user, agentEvents } = await run()
  const before = meter.measure(session, { config: route }).totalTokens
  const fiber = ctx.plugin({ apply: guard.apply, Config: guard.Config, inject: guard.inject }, {
    rules: [{ ...route, surchargeAtTokens: 1000 }], safetyMarginTokens: 100, maxAttempts: 1,
  })
  try {
    await new Promise(resolve => setImmediate(resolve))
    const admitted = [user('new step input')]
    const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      turn: 1, step: 1, signal, modelSelection: route, messages: admitted,
    }, async () => ({ kind: 'enter', messages: admitted }))
    assert.deepEqual(decision, { kind: 'enter', messages: admitted })
    assert.equal(summaries.length, 1)
    const after = meter.measure(session, { config: route }).totalTokens
    assert.ok(before >= 1000 && after < 900, `expected history to shrink below trigger; ${before} → ${after}`)
    assert.deepEqual(session.snapshotEvents().slice(-4).map(event => event.type), [
      'compaction/start', 'compaction/summary', 'user/message', 'compaction/end',
    ])
    // No override: the session's own backend summarized, on the session route.
    assert.deepEqual(summaries[0], { provider: '', model: '' })
    const summaryEvent = session.snapshotEvents().find(event => event.type === 'compaction/summary')
    assert.deepEqual([summaryEvent.data.provider, summaryEvent.data.model], [route.provider, route.model])
  } finally {
    await fiber.dispose()
  }
})

test('installed DSH: a per-rule route starts a separate backend and is recorded', { skip: !useInstalled }, async () => {
  const { ctx, session, route, agent, signal, summaries, meter, user, agentEvents } = await run()
  const target = { provider: 'offline-summary', model: 'cheap' }
  const fiber = ctx.plugin({ apply: guard.apply, Config: guard.Config, inject: guard.inject }, {
    rules: [{ ...route, surchargeAtTokens: 1000, summaryTarget: target }], safetyMarginTokens: 100, maxAttempts: 1,
  })
  try {
    await new Promise(resolve => setImmediate(resolve))
    const admitted = [user('new step input')]
    await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      turn: 1, step: 1, signal, modelSelection: route, messages: admitted,
    }, async () => ({ kind: 'enter', messages: admitted }))
    // Exactly one summary came from an instance configured with the chosen route.
    assert.deepEqual(summaries, [target])
    const summaryEvent = session.snapshotEvents().find(event => event.type === 'compaction/summary')
    assert.deepEqual([summaryEvent.data.provider, summaryEvent.data.model], [target.provider, target.model])
    // The session still measures against its own route, and its backend is intact.
    assert.ok(meter.measure(session, { config: route }).totalTokens < 900)
    assert.equal(ctx.get('compaction'), undefined, 'no root service was left behind')
  } finally {
    await fiber.dispose()
  }
})
