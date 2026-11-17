[中文](README.md)

# dsh-surcharge-guard

Set a double-billing threshold per model, and compact context before a request crosses it. Built for long-context models such as GPT, Gemini and Grok that bill at double rate past a fixed line.

## Why the context window is the wrong knob

DSH decides when to compact with:

```
T = min(W × thresholdRatio, W − output − headroom)
```

`W` is the context window. The first term is a fraction of `W`, so **shrinking the window drags the trigger down with it**. For a model billed at double rate past 272K:

| `W` | output | headroom | trigger `T` |
|---:|---:|---:|---:|
| 1,050,000 | 128,000 | 65,536 | 840,000 |
| 272,000 | 128,000 | 65,536 | **78,464** |
| 272,000 | 32,000 | 22,400 | 217,600 (ceiling) |

Setting the window to 272K does not fire at 272K; it fires at 78K, because `W − output − headroom` collapses first. And `W × 0.8` locks the trigger at 217,600, so a 272K window can never fire near 272K.

This plugin writes the threshold directly and solves for the headroom:

```
headroom = W − output − (line − safetyMargin)
```

The window keeps its real capacity; only the trigger position moves.

## Usage

After installing, open **Settings → Surcharge guard**:

1. Turn the master switch on.
2. Click "Add all GPT models", "Add all Gemini models" and so on to create rules for every matching model across all providers in one go.
3. Check each threshold in the table and edit the number where needed. The "Triggers at" column shows the computed compaction point.

| Goal | Action |
|---|---|
| Guard only a few models | Bulk add, then set the rest to Off or remove them |
| Change one model's threshold | Edit the number in the threshold column |
| Compact less often | Raise the safety margin |
| Pause everything for a turn | Turn the master switch off; rules are kept |

Number fields accept `272000`, `272K` and `1.05M`.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch; off stops every rule |
| `rules` | `[]` | Each is `{ provider, model, surchargeAtTokens, enabled }` |
| `safetyMarginTokens` | `20000` | How far below the line to trigger |
| `retainRatio` | `0.16` | Fraction of recent content kept verbatim |
| `maxAttempts` | `2` | Maximum summary attempts within one turn |

Every field is volatile: changes apply on the next step without restarting the plugin.

## Built-in thresholds

| Family | Line | Match |
|---|---:|---|
| GPT | 272K | `gpt` at a word start in the model id |
| Gemini | 200K | model id contains `gemini` |
| Grok | 200K | model id contains `grok` |

The thresholds are the providers' published numbers, not derived from the window. When a provider changes pricing, edit the number in the table.

## Limitations

- **Compaction costs tokens.** Every fold sends a summarization request. With a low threshold and long turns, summarization can cost more than the surcharge it prevents; raise the margin or disable specific models.
- **The check runs between steps.** A single step that appends a very large tool result can still cross the line before the next check. The safety margin covers ordinary growth, not one enormous append.
- **A summary may refuse to shrink.** When a region is already dense, the summary can come back no smaller than the original. `maxAttempts` stops it from being retried on every step of the same turn.

## How it works

Before each step the plugin reads the model that step is routed to. When a rule matches and usage enters the safety-margin band, it selects a tool-pairing-balanced span and hands it to the session's own compaction service to fold into one summary.

The plugin writes no new session event type and replaces no service. The only durable writes are the `compaction/start` .. `compaction/end` pair that `compactRegion` already owns, so fork, resume and replay behave exactly as they do without the plugin.

The cut rewinds to the nearest tool-pairing balanced position, and a leading system message is never inside the span.

## Development

```
pnpm install
pnpm check          # syntax + locale consistency + all tests
pnpm test           # tests only
```

- `logic.js` is a pure, dependency-free module; `tests/logic.test.mjs` tests it directly.
- `tests/client.test.mjs` mounts the settings page with `react-test-renderer` and a stubbed `fetch`, covering the table, bulk add, commit timing and failure states.
- `index.js` is the Host half: it registers `agent/pre-step` and three same-origin routes for the settings page.
- `client.js` is the browser half, registering one `settings.section` page. All state lives in the Host; the page only fetches, renders and posts edits.
- `locale/*.json` holds the display text Plugin Manager reads; the UI strings are inlined in `client.js`, and `scripts/check-locale.mjs` keeps the two copies in step.

## License

[MIT](LICENSE)
