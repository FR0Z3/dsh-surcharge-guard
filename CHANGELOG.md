# Changelog

## 0.1.0

Initial release.

- Per-model double-billing threshold with an explicit `surchargeAtTokens` value
  instead of a derived window fraction.
- Settings page under **Settings → Surcharge guard** listing every guarded model
  with its line and computed trigger point.
- One-click rules for all GPT, Gemini and Grok models across every configured
  provider, using each provider's published threshold.
- Safety margin that absorbs token-meter estimation error.
- Tool-pairing-balanced span selection, so a fold never splits an assistant tool
  call from its result, and a leading system message is never folded.
- Volatile configuration: toggles and edits apply on the next step without
  restarting the plugin.
