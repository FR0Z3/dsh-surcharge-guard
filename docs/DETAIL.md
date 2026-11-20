# dsh-surcharge-guard

Some providers charge more for long prompts even when the request still fits the model's context window. Set a surcharge threshold for the exact provider and model without altering the context window.

## Configure protection

Open **Plugins → Surcharge guard**. Enter a rule manually, or prefill suggestions for matching GPT, Gemini, or Grok model IDs. New rules start off. Confirm the threshold against your provider's pricing before turning a rule on.

The guard starts checking at `max(1, surcharge threshold − safety margin)`. A larger margin triggers earlier. The retain ratio sets a recent-history budget as a fraction of that trigger. The summary attempt limit applies to the current turn; `0` disables guard compaction.

## What happens before a step

The guard matches the selected route, measures the committed history, and adds an estimate for the messages admitted for that step. It delegates to the agent preset's compaction service (or a root backend where applicable), preserves the leading system message and tool pairs, and measures again after each successful summary. Only the backend records compaction events.

A rule may name a summary model. That route cannot be passed through `compactRegion`, which takes only a range, an agent and a signal, and the Basic backend keeps its summary route in instance state. So the guard mounts one Basic instance inside a fresh `compaction` realm for that transaction and disposes it afterwards: concurrent sessions never share or overwrite a route, and the session's own backend is never rebound. The class comes from the backend the preset already mounted, and the summary budget is inherited from the routed policy. A backend without Basic's summary settings is reported instead of being replaced; a failed route warns and does not fall back. Another provider receives the selected history and the summary request's prompts and tool definitions.

A rule may also name a reasoning effort for that summary model. Basic's own configuration cannot carry one — its loader rejects unknown keys in `resolveConfig`, and the summarizer builds each request itself — so the effort rides on the `llm` service the engine resolves. The guard nests an isolated `llm` scope inside the transaction's `compaction` realm and provides an effort-bound view of it before starting the backend, so only that transaction's summary call is affected and the shared service is never replaced.

The view reports no tracker on purpose. A tracked service is re-wrapped for every reader, and that re-wrap resolves `stream` from the prototype descriptor, which would discard the override and silently send the route's default effort instead. Forwarding the tracker "for correctness" breaks the feature without failing anything else, so the hidden symbol is load-bearing rather than dead code. Binding every function also replaces `constructor` with a bound wrapper, so the view's `constructor` is not the runtime class; `instanceof` still holds, and nothing in the harness dispatches on either.

The route and its effort are validated through `llm.resolveCallConfig` before the transaction opens, so an unsupported level becomes one warning and that compaction never runs — no marker pair, no summary request, and no attempt spent against the per-turn limit. The effort is route-owned in the settings page, which drops it when the summary model changes; the config layer keeps whatever a hand-edited route carries and the pre-flight check rejects it. The effort appears only once a custom summary model is chosen; DSH's own summary settings, manual compaction and the chat route keep theirs.

The estimate is not the final provider token count. If the history cannot be compacted enough, the guard leaves the step decision unchanged and reports the problem in the host log. A separate summary request can incur charges. The attempt limit does not cover native DSH compaction or the backend's internal retries.
