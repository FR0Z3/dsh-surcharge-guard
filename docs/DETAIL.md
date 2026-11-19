# dsh-surcharge-guard

Some providers charge more for long prompts even when the request still fits the model's context window. Set a surcharge threshold for the exact provider and model without altering the context window.

## Configure protection

Open **Plugins → Surcharge guard**. Enter a rule manually, or prefill suggestions for matching GPT, Gemini, or Grok model IDs. New rules start off. Confirm the threshold against your provider's pricing before turning a rule on.

The guard starts checking at `max(1, surcharge threshold − safety margin)`. A larger margin triggers earlier. The retain ratio sets a recent-history budget as a fraction of that trigger. The summary attempt limit applies to the current turn; `0` disables guard compaction.

## What happens before a step

The guard matches the selected route, measures the committed history, and adds an estimate for the messages admitted for that step. It delegates to the agent preset's compaction service (or a root backend where applicable), preserves the leading system message and tool pairs, and measures again after each successful summary. Only the backend records compaction events.

A rule may name a summary model. That route cannot be passed through `compactRegion`, which takes only a range, an agent and a signal, and the Basic backend keeps its summary route in instance state. So the guard mounts one Basic instance inside a fresh `compaction` realm for that transaction and disposes it afterwards: concurrent sessions never share or overwrite a route, and the session's own backend is never rebound. The class comes from the backend the preset already mounted, and the summary budget is inherited from the routed policy. A backend without Basic's summary settings is reported instead of being replaced; a failed route warns and does not fall back. Another provider receives the selected history and the summary request's prompts and tool definitions.

The estimate is not the final provider token count. If the history cannot be compacted enough, the guard leaves the step decision unchanged and reports the problem in the host log. A separate summary request can incur charges. The attempt limit does not cover native DSH compaction or the backend's internal retries.
