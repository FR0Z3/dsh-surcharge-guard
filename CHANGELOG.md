# Changelog

## Unreleased

- Add an optional summary model per rule. A rule can name the provider and model that writes its summaries; the chat model, manual compaction and DSH's own policy keep their settings. The route runs through a separate Basic backend in its own `compaction` realm for that transaction, so concurrent sessions never share or overwrite it. A backend that does not take Basic's summary settings is reported instead of being replaced, and a failed route warns without falling back.
- Estimate pressure for the selected step route and the messages admitted by other pre-step middleware. Remeasure after summaries, warn about unresolved pressure, and leave the original step decision unchanged.
- Enforce a per-turn compaction attempt budget. Zero disables guard compaction, and an unavailable range does not spend an attempt.
- Preserve exact numeric settings, expose retention, and support manual rule entry. New rules start disabled until their provider thresholds are confirmed.
- Distinguish catalog failures from an empty catalog and keep configured models available when a live provider is unavailable.
- Remove the unreachable bundle-list summary, browser test exports, and unused host family helpers. The `./logic` subpath still exposes normalization and range selection.

## 0.1.0

- Add an explicit `surchargeAtTokens` value for each provider and model.
- Configure rules under **Plugins → Surcharge guard**.
- Use the session's compaction backend with tool-pair-safe range selection and preserve the leading system message.
