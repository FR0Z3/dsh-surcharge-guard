/**
 * dsh-surcharge-guard — Host half.
 *
 * Some providers bill a request at double rate once the prompt crosses a
 * threshold that sits well below the advertised context window. Shrinking the
 * window does not fix that: compaction fires at
 * `min(W * thresholdRatio, W - output - headroom)`, so a 272K window caps the
 * trigger at `272K * 0.8 = 217.6K` and can never fire near the line.
 *
 * This plugin adds the field that is actually missing — an explicit "double
 * billing starts here" number per model — and folds history through the
 * session's own compaction service before a step crosses it.
 *
 * It writes no new session event type and replaces no service. The only durable
 * writes are the `compaction/start` .. `compaction/end` pair that
 * `compactRegion` already owns. Decision logic lives in `./logic.js` so it can
 * be tested without a runtime.
 *
 * @module dsh-surcharge-guard
 */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULTS,
  FAMILIES,
  PLUGIN_ID,
  familyOf,
  normalizeConfig,
  ruleFor,
  selectRange,
} from './logic.js'

export { DEFAULTS, FAMILIES, PLUGIN_ID, familyOf, normalizeConfig, normalizeRule, ruleFor, selectRange, balanceCuts } from './logic.js'

/** Same-origin base for the settings page's reads and writes. */
const ROUTE_BASE = `/plugins/${PLUGIN_ID}`

/** Largest request body a settings write may carry. */
const MAX_BODY_BYTES = 256 * 1024

/** Send one JSON response. */
function sendJson(res, status, body) {
  const payload = `${JSON.stringify(body)}\n`
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/** Read a JSON request body, or `undefined` when it is absent or malformed. */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/**
 * Enumerate provider routes and the models each one advertises.
 *
 * Every per-model lookup is bounded, so one slow or failing provider cannot
 * stall the settings page.
 */
async function enumerateModels(ctx) {
  const llm = ctx.llm
  const rows = []
  for (const provider of llm.listProviders()) {
    let models
    try {
      models = await llm.listModels(provider.id)
    } catch {
      continue
    }
    for (const model of models) {
      let contextWindow
      try {
        const info = await llm.resolveModelInfo(provider.id, model.id, AbortSignal.timeout(2000))
        contextWindow = info.context?.contextWindow
      } catch {
        contextWindow = undefined
      }
      rows.push({
        provider: provider.id,
        providerName: provider.name,
        model: model.id,
        name: model.name ?? model.id,
        ...contextWindow === undefined ? {} : { contextWindow },
        family: familyOf(model.id) ?? null,
      })
    }
  }
  return rows
}

/**
 * Resolve the compaction service that governs one agent.
 *
 * The shipped preset mounts `compaction` inside an isolated realm, so the root
 * realm has no such service; the preset registry is the supported way to reach
 * the instance that actually owns this Agent's session.
 *
 * @param ctx - plugin context.
 * @param agent - agent whose scope is consulted.
 * @returns the governing compaction service, or `undefined`.
 */
function compactionFor(ctx, agent) {
  return ctx.get('agentPresets')?.serviceFor(agent, 'compaction') ?? ctx.get('compaction')
}

/**
 * Fold history until the next prompt is back under the guarded line.
 *
 * @param ctx - plugin context.
 * @param config - normalized configuration.
 * @param agent - agent about to take a step.
 * @param signal - step cancellation.
 * @returns a short outcome word for logging.
 */
async function enforce(ctx, config, agent, signal) {
  const session = agent.session
  const header = session.requestHeader()
  if (header === undefined) return 'no-route'
  const rule = ruleFor(config, header.config)
  if (rule === undefined) return 'unguarded'

  const compaction = compactionFor(ctx, agent)
  if (compaction === undefined) return 'no-compaction'

  const measurement = ctx.tokenMeter.measure(session)
  const cap = Math.max(1, rule.surchargeAtTokens - config.safetyMarginTokens)
  if (measurement.totalTokens < cap) return 'under-cap'

  const range = selectRange(session, measurement.nodes, Math.floor(cap * config.retainRatio))
  if (range === undefined) return 'no-range'
  if (signal.aborted) return 'aborted'

  const result = await compaction.compactRegion(range.start, range.end, agent, signal)
  ctx.logger.info(
    `surcharge guard (${rule.provider}/${rule.model}): folded ${result.shadowedSeqs.length} nodes, `
    + `cap ${cap}, line ${rule.surchargeAtTokens}, was ${measurement.totalTokens} estimated tokens`,
  )
  return 'compacted'
}

/**
 * Config schema.
 *
 * Every field is volatile: the settings page writes them, and a toggle must take
 * effect on the next step rather than restarting the plugin mid-session. The
 * live values are read through `liveValue()` on every step.
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  rules: z.array(z.object({
    provider: z.string().required(),
    model: z.string().required(),
    surchargeAtTokens: z.number().step(1).min(1).required(),
    enabled: z.boolean().default(true),
  })).default([]).volatile(),
  safetyMarginTokens: z.number().step(1).min(0).default(DEFAULTS.safetyMarginTokens).volatile(),
  retainRatio: z.number().min(0.01).max(0.9).default(DEFAULTS.retainRatio).volatile(),
  maxAttempts: z.number().step(1).min(0).default(DEFAULTS.maxAttempts).volatile(),
})

/** Services this plugin cannot run without. */
export const inject = ['llm', 'tokenMeter']

export function apply(ctx, rawConfig) {
  /** Read the current config, unwrapping live references. */
  const read = () => normalizeConfig(rawConfig)

  // Per-session attempt budget: a summary that refuses to shrink must not be
  // retried on every step of the same turn.
  const attempts = new WeakMap()
  const attemptKey = session => session.seq > 0 ? session.surface.nodes.length : 0

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const config = read()
    if (config.enabled && config.rules.length > 0 && !signal.aborted) {
      const state = attempts.get(agent.session) ?? { key: attemptKey(agent.session), used: 0 }
      if (state.key !== attemptKey(agent.session)) {
        state.key = attemptKey(agent.session)
        state.used = 0
      }
      if (state.used <= config.maxAttempts) {
        try {
          const outcome = await enforce(ctx, config, agent, signal)
          if (outcome === 'compacted' || outcome === 'no-range') state.used += 1
        } catch (error) {
          state.used += 1
          ctx.logger.warn(
            `surcharge guard: ${error instanceof Error ? error.message : String(error)}; `
            + 'continuing the step',
          )
        }
      }
      attempts.set(agent.session, state)
    }
    return next()
  })

  const webServer = ctx.get('webServer')
  if (webServer === undefined) return

  /** Refuse a request that DSH's own connection trust already rejects. */
  const refused = (req, res) => {
    const rejection = ctx.get('connection')?.requestRejection(req)
    if (rejection === undefined) return false
    sendJson(res, rejection, { ok: false, error: 'refused' })
    return true
  }

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/state`,
    handler: (req, res) => {
      if (refused(req, res)) return
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method' })
      const entry = ctx.fiber.entry
      sendJson(res, 200, {
        ok: true,
        config: read(),
        families: FAMILIES,
        writable: entry !== undefined && ctx.get('configEditor') !== undefined,
      })
    },
  }), `${PLUGIN_ID}: state route`)

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/models`,
    handler: async (req, res) => {
      if (refused(req, res)) return
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method' })
      try {
        sendJson(res, 200, { ok: true, models: await enumerateModels(ctx) })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error) })
      }
    },
  }), `${PLUGIN_ID}: models route`)

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/config`,
    handler: async (req, res) => {
      if (refused(req, res)) return
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method' })
      // Requiring JSON forces a preflight for a cross-origin form post.
      if (!String(req.headers['content-type'] ?? '').includes('application/json')) {
        return sendJson(res, 415, { ok: false, error: 'content-type' })
      }
      const body = await readJsonBody(req)
      if (body === undefined) return sendJson(res, 400, { ok: false, error: 'body' })
      const next = normalizeConfig(body)
      const entry = ctx.fiber.entry
      const editor = ctx.get('configEditor')
      if (entry === undefined || editor === undefined) {
        return sendJson(res, 409, { ok: false, error: 'not-writable' })
      }
      try {
        await editor.edit(entry, () => ({
          enabled: next.enabled,
          rules: next.rules,
          safetyMarginTokens: next.safetyMarginTokens,
          retainRatio: next.retainRatio,
          maxAttempts: next.maxAttempts,
        }))
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: String(error) })
      }
      sendJson(res, 200, { ok: true, config: next })
    },
  }), `${PLUGIN_ID}: config route`)
}
