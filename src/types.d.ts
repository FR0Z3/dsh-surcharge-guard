/**
 * Ambient declarations for the runtime shapes this guard touches.
 *
 * The framework's own packages ship as JavaScript without declarations, so this
 * file declares the parts of the DSH Host the guard actually observes: the
 * `tokenMeter` service, the session surface, the compaction and pruning
 * services, the `llm` service, and the `agent/pre-step` / `llm/stream` event
 * payloads. Members are narrowed to the fields the guard reads or passes
 * through; a later framework rename of any field named here fails the type gate
 * instead of letting the guard quietly misread a payload.
 *
 * This file is a declaration module: it is never imported by name and never
 * compiles to a runtime artifact, so the runtime sources erase to themselves.
 */

/** Values DSH hands over as live (volatile) config references. */
type ConfigField<T> = (T & { get?: undefined }) | { get(): T }

/** A routed provider and model, as DSH names them in config and headers. */
interface Route {
  provider: string
  model: string
}

/** Summary route one rule may pin, with an optional reasoning effort. */
interface SummaryTarget extends Route {
  /** Effort id the route must serve; absent means the route's own default. */
  reasoningEffort?: string
}

/** One normalized guard rule; a missing `summaryTarget` means the session route. */
interface Rule {
  provider: string
  model: string
  surchargeAtTokens: number
  enabled: boolean
  summaryTarget?: SummaryTarget
}

/** Normalized guard configuration; every field volatile between steps. */
interface GuardConfig {
  enabled: boolean
  rules: Rule[]
  safetyMarginTokens: number
  retainRatio: number
  maxAttempts: number
  enforceLine: boolean
}

/** Raw config document as the Loader row or the settings page provides it. */
interface RawConfig {
  enabled?: ConfigField<boolean>
  rules?: ConfigField<unknown[]>
  safetyMarginTokens?: ConfigField<unknown>
  retainRatio?: ConfigField<unknown>
  maxAttempts?: ConfigField<unknown>
  enforceLine?: ConfigField<boolean>
}

/** One priced surface node, as `tokenMeter.measure()` reports. */
interface PricedNode {
  seq: number
  tokens: number
}

/**
 * Provider usage record a measurement baseline may carry.
 *
 * A type alias, not an interface, so a concrete record stays assignable to
 * `Record<string, unknown>` through TS's implicit index signature.
 */
type UsageRecord = {
  inputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  outputTokens?: number
}

/** What `tokenMeter.measure()` learned the committed history costs. */
interface Baseline {
  kind: 'usage' | 'estimated' | 'none'
  tokens?: number
  usage?: UsageRecord
}

/**
 * Result of `tokenMeter.measure(session, header)`.
 *
 * `totalTokens`, `surfaceTokens` and `surfaceDeltaTokens` are always present
 * in the service's return; the guard still narrows before using them, because
 * the raw config path (`logic.ts`) also runs in a plain Node test fixture.
 */
interface Measurement {
  baseline: Baseline
  surfaceTokens: number
  surfaceDeltaTokens: number
  totalTokens: number
  nodes: PricedNode[]
}

/** Request envelope: routed config plus the tools the request carries. */
interface RequestHeader {
  config: Route & {
    reasoningEffort?: string
    [key: string]: unknown
  }
  adapterDefaults?: Record<string, unknown>
  tools?: unknown[]
}

/** Anything carrying a tool-schema list the meter prices. */
interface ToolEnvelope {
  tools?: unknown[]
}

/** The session surface: node seqs in model-visible order, plus fold metadata. */
interface Surface {
  nodes: number[]
  replaceGeneration?: number
}

/** A message the guard prices, or passes through to a request. */
interface ChatMessage {
  role: string
  [key: string]: unknown
}

/** Session surface the guard reads: event lookup and the retained nodes. */
interface SessionLike {
  id: unknown
  surface: Surface
  eventAt(seq: number): SessionEvent | undefined
  requestHeader(): RequestHeader | undefined
}

/** Journal event, narrowed to the kinds the guard inspects. */
interface SessionEvent {
  seq: number
  type: string
  data?: {
    /** Assistant content blocks the guard counts tool calls in. */
    message?: { content?: Array<{ type?: unknown }> }
    source?: { kind?: string }
    [key: string]: unknown
  }
}

/** The compaction service both the session and an isolated engine share. */
/** Config shape of a Basic-style compaction backend the guard inspects. */
interface BasicBackendConfig {
  summarizationProvider?: string
  summarizationModel?: string
  maxTokens?: number
  modelPolicies?: Array<{ provider: string, model: string, maxTokens?: number }>
  [key: string]: unknown
}

interface CompactionService {
  compactRegion(start: number, end: number, owner: unknown, signal: AbortSignal): Promise<CompactionResult>
  config?: BasicBackendConfig
  constructor?: new (...args: any[]) => unknown
}

/** The tool-result pruner the hard line runs before a forced fold. */
interface PrunerService {
  /** Pruning reads only; the result reflects what the session already holds. */
  pruneSession(session: unknown): { pruned: unknown[]; charsRemoved: number }
}

/** `llm` service, narrowed to the calls the summary effort path makes. */
interface LlmService {
  resolveCallConfig(config: Route & { reasoningEffort?: string }, signal?: AbortSignal): Promise<unknown>
  stream(options: any): AsyncIterable<unknown>
  [key: string]: any
}

/** What the `agentPresets` service answers `serviceFor` with. */
interface AgentPresets {
  serviceFor(owner: unknown, name: string): any
}

/** Result of `foldFloor(cap)`; both fields optional for a floor-less call. */
type FoldFloorResult = { summaryTokens?: number, minReclaimTokens?: number }

/** Attempt state for one turn of one session, route included. */
interface AttemptBudget {
  turn: number
  provider: string
  model: string
  attempts: number
  reported: Set<string>
}

/** What one committed `compactRegion` transaction produced. */
interface CompactionResult {
  shadowedSeqs: number[]
}

/** A fiber-like plugin handle the guard disposes after one transaction. */
interface Fiber extends Promise<{ ctx: { get<T = any>(name: string): T | undefined } }> {
  dispose(): Promise<void>
}

/** A realm the guard isolates services and mounts a backend in. */
interface Realm {
  isolate(name: 'llm'): Realm
  provide(name: 'llm', value: unknown): () => void
  plugin(Engine: unknown, settings: Record<string, unknown>): Fiber
}

/** Cordis context the Host guard runs on, narrowed to what it touches. */
interface Context {
  /**
   * Resolve a service by name. The caller picks the expected type through the
   * type argument; `undefined` is returned when the service is absent, and an
   * absent service of the wrong shape is a runtime, not a type, question.
   */
  get<T = any>(name: string): T | undefined
  isolate(name: 'compaction'): Realm
  on(name: string, handler: (...args: any[]) => unknown, opts?: Record<string, unknown>): void
  tokenMeter: TokenMeterService
  logger: { info(message: string): void; warn(message: string): void }
}

/** The `tokenMeter` service, narrowed to the calls the guard makes. */
interface TokenMeterService {
  measure(session: unknown, header?: RequestHeader): Measurement
  estimateMessage(message: ChatMessage): number
}

/** The `agent/pre-step` event the guard guards one step with. */
interface PreStepEvent {
  agent: { session: SessionLike; model?: { current(): Route | undefined } }
  signal: AbortSignal
  turn: number
  modelSelection?: Route & { reasoningEffort?: string }
}

/** What downstream `agent/pre-step` middleware decided for this step. */
interface StepDecision {
  kind: 'enter' | 'reject'
  messages: ChatMessage[]
}

/** The `llm/stream` request the dispatch gate prices at the boundary. */
interface StreamRequest extends Route {
  sessionId?: unknown
  purpose?: string
  messages?: ChatMessage[]
  tools?: unknown[]
}

interface NumberConstructor {
  isFinite(value: unknown): value is number
}

/** Client side: browser runtime this bundle's Client entry registers into. */
interface Window {
  __ModuleLoader__: {
    load(module: { id: string, factory: (require: (id: string) => unknown) => ClientModule }): void
  }
}

/** What a Client factory returns: the shape Cordis-Web loads as a plugin. */
interface ClientModule {
  inject?: string[]
  apply(ctx: ClientContext): unknown
}

/** Client context: slots and locale services, plus optional services. */
interface ClientContext {
  effect(run: () => unknown, label?: string): unknown
  locale: {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): unknown
    bind(namespace: string): (key: string) => string
  }
  slots: {
    inject(slot: string, run: (register: (options: ClientSlotOptions, renderer: (props: any) => unknown) => unknown) => void): void
    register(options: ClientSlotOptions, renderer: (props: any) => unknown): unknown
  }
  get(key: string): any
}

/** Client slot registration options the bundle passes. */
interface ClientSlotOptions {
  name: string
  key: string
  locale: string
}
