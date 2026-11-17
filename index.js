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
}

