# dsh-surcharge-guard

Some providers bill a request at **double rate** once the prompt crosses a
threshold that sits well below the advertised context window. The prompt is then
priced higher even though the request still fits.

This plugin adds the missing number — an explicit *double billing starts here*
per model — and folds history through the session's own compaction service
before a step crosses it.

## Why the context window is the wrong knob

DSH decides when to compact with:

```
T = min(W × thresholdRatio, W − output − headroom)
```

`W` is the context window. Because the first term is a fraction of `W`, shrinking
the window drags the trigger down with it. For a model billed at double rate past
272K:

| `W` | output | headroom | trigger `T` |
|---:|---:|---:|---:|
| 1,050,000 | 128,000 | 65,536 | 840,000 |
| 272,000 | 128,000 | 65,536 | **78,464** |
| 272,000 | 32,000 | 22,400 | 217,600 (ceiling) |

Setting the window to 272K does not fire at 272K; it fires at 78K, because
`W − output − headroom` collapses. And `W × 0.8` caps the trigger at 217,600, so
a 272K window can never trigger near 272K at all.

Writing the threshold directly inverts the arithmetic. The plugin solves for the
headroom that lands the trigger where you asked:

```
headroom = W − output − (line − safetyMargin)
```

Only the guard's own threshold is written; the window keeps its real capacity.

## What you get

- One settings page, **Settings → Surcharge guard**, listing every guarded model
  with its line, its computed trigger point, and a per-model on/off.
- A **threshold per model**, so GPT can sit at 272K while Gemini and Grok sit at
  200K.
- **One-click rules** for every GPT, Gemini or Grok model across every configured
  provider, using each provider's published number.
- A **safety margin** that absorbs estimation error, because the token meter
  reports provider usage plus a heuristic increment rather than an exact count.

## How it decides

Before each step the guard reads the step's routed model. If a rule matches and
the measured context is within `safetyMargin` of the line, it selects a
tool-pairing-balanced span and asks the session's compaction service to fold it
into one summary. A cut that would split an assistant tool call from its result
is rewinded to the nearest balanced position; a leading system message is never
inside the span.

The guard writes no new session event type and replaces no service. The only
durable writes are the ordinary `compaction/start` .. `compaction/end` pair that
`compactRegion` already owns, so fork, resume and replay behave exactly as they
do without the plugin.

## Limitations

- **Compaction is not free.** Each fold sends a summarization request, which costs
  tokens. On a model with a low threshold and long turns this can cost more than
  the surcharge it prevents; raise the margin or disable specific models.
- **The check runs between steps.** A single step that appends a very large tool
  result can still cross the line before the next check. The safety margin covers
  ordinary growth, not one enormous append.
- **Thresholds are operator-supplied.** The built-in numbers are 272K for GPT and
  200K for Gemini and Grok. Providers change pricing; edit the number per model
  when they do.
- **Summaries can refuse to shrink.** When a region is already dense, the
  summarizer may return text that is not smaller than what it replaces. The retry
  limit stops it from being attempted on every step of the same turn.
