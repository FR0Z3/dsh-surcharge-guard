/**
 * dsh-surcharge-guard — Client half.
 *
 * Renders one `settings.section` page. All state lives in the Host: this module
 * only fetches, renders, and posts edits back, so the page never disagrees with
 * what the guard actually does.
 *
 * The Host exposes three same-origin routes (see `index.js`):
 *   GET  /plugins/dsh-surcharge-guard/state   current config + family table
 *   GET  /plugins/dsh-surcharge-guard/models  provider catalog with windows
 *   POST /plugins/dsh-surcharge-guard/config  validated save
 *
 * @module dsh-surcharge-guard/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-surcharge-guard',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** The section id is also the settings nav icon's address. */
    const SECTION_ID = 'dsh-surcharge-guard'
    /** Same-origin base shared with the Host half. */
    const ROUTE_BASE = `/plugins/${SECTION_ID}`
    /** Locale namespace for this plugin's strings. */
    const NS = 'dsh-surcharge-guard'

    /** Page strings; kept in step with `locale/*.json` by `scripts/check-locale.mjs`. */
    const zh = {
          "nav": "计费保护",
          "title": "计费保护",
          "intro": "超过起点后，provider 按双倍计费。开启后，插件会在每次请求前检查用量，到线前压缩历史。",
          "enabled": "启用计费保护",
          "enabledHint": "关闭后所有规则停止生效，已有配置保留。",
          "margin": "安全余量",
          "marginHint": "在起点以下多少 token 触发压缩。估算有误差，留出余量才不会越线。",
          "retain": "保留比例",
          "retainHint": "压缩时保留最近多少比例的内容不摘要。",
          "maxAttempts": "重试上限",
          "maxAttemptsHint": "同一轮内摘要失败的最大重试次数，避免反复调用。",
          "rules": "规则",
          "rulesEmpty": "还没有规则。用下面的按钮按家族批量添加，或手动添加单条。",
          "colProvider": "服务商",
          "colModel": "模型",
          "colLine": "双倍计费起点",
          "colWindow": "上下文窗口",
          "colStatus": "状态",
          "colActions": "操作",
          "on": "已保护",
          "off": "已停用",
          "cap": "到线前触发于",
          "remove": "移除",
          "addTitle": "一键添加",
          "addHint": "为所有服务商里匹配到的模型添加规则，阈值取 provider 公布的起点。",
          "addFamily": "添加全部 {family} 模型",
          "addManual": "手动添加",
          "scan": "重新扫描模型",
          "scanning": "正在读取模型目录…",
          "noModels": "没有读到任何模型。请确认已在「模型」设置里配置服务商。",
          "unknownFamily": "未识别的模型需要手动填写起点。",
          "saved": "已保存",
          "saveFailed": "保存失败",
          "notWritable": "当前配置层不可写，请检查 profile 配置。",
          "loading": "正在加载…",
          "loadFailed": "读取失败",
          "retry": "重试",
          "familyGpt": "GPT",
          "familyGemini": "Gemini",
          "familyGrok": "Grok",
          "docs": "说明",
          "providerAll": "全部服务商"
    }

    const en = {
          "nav": "Surcharge guard",
          "title": "Surcharge guard",
          "intro": "Past the threshold, the provider bills the request at double rate. With this on, the plugin measures usage before each request and folds history before reaching the line.",
          "enabled": "Enable surcharge guard",
          "enabledHint": "Turning this off stops every rule; saved rules are kept.",
          "margin": "Safety margin",
          "marginHint": "How far below the threshold to trigger. Measurement is an estimate, so the margin absorbs the error.",
          "retain": "Retain ratio",
          "retainHint": "Fraction of recent content kept verbatim when folding.",
          "maxAttempts": "Retry limit",
          "maxAttemptsHint": "Maximum summary attempts within one turn, so a stubborn history is not retried forever.",
          "rules": "Rules",
          "rulesEmpty": "No rules yet. Add a model family in bulk below, or add one manually.",
          "colProvider": "Provider",
          "colModel": "Model",
          "colLine": "Double-billing threshold",
          "colWindow": "Context window",
          "colStatus": "Status",
          "colActions": "Actions",
          "on": "Guarded",
          "off": "Off",
          "cap": "Triggers at",
          "remove": "Remove",
          "addTitle": "Quick add",
          "addHint": "Add a rule for every matching model across all providers, using the provider's published threshold.",
          "addFamily": "Add all {family} models",
          "addManual": "Add manually",
          "scan": "Rescan models",
          "scanning": "Reading model catalog…",
          "noModels": "No models found. Make sure a provider is configured under Models.",
          "unknownFamily": "Unrecognized models need a manually entered threshold.",
          "saved": "Saved",
          "saveFailed": "Save failed",
          "notWritable": "This configuration layer is not writable. Check the profile configuration.",
          "loading": "Loading…",
          "loadFailed": "Failed to load",
          "retry": "Retry",
          "familyGpt": "GPT",
          "familyGemini": "Gemini",
          "familyGrok": "Grok",
          "docs": "About",
          "providerAll": "All providers"
    }

    /** Compact form already formatted by the Host, shown as a fallback. */
    function formatTokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`
      if (value >= 1000) return `${Math.round(value / 1000)}K`
      return String(value)
    }

    /** Parse a token field that accepts `272000`, `272K` and `1.05M`. */
    function parseTokens(text) {
      const raw = String(text).trim().toLowerCase().replace(/[,_\s]/g, '')
      if (raw.length === 0) return undefined
      const match = /^([0-9]*\.?[0-9]+)([km])?$/.exec(raw)
      if (match === null) return undefined
      const base = Number(match[1])
      if (!Number.isFinite(base)) return undefined
      const scale = match[2] === 'm' ? 1000000 : match[2] === 'k' ? 1000 : 1
      const value = Math.round(base * scale)
      return value > 0 ? value : undefined
    }

    /** Fetch JSON from a plugin route, surfacing a non-2xx body as an error. */
    async function fetchJson(path, init) {
      const response = await fetch(`${ROUTE_BASE}${path}`, {
        credentials: 'same-origin',
        ...init,
      })
      let body
      try {
        body = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok || body?.ok !== true) {
        throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
      }
      return body
    }

    // ---- styles -----------------------------------------------------------
    // Only `--dsw-alias-*` tokens, so light/dark switching is automatic.

    const styles = {
      page: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        fontSize: '13px',
        color: 'var(--dsw-alias-label-primary)',
      },
      intro: {
        margin: 0,
        color: 'var(--dsw-alias-label-secondary)',
        lineHeight: 1.6,
      },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        borderRadius: '10px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      row: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '16px',
      },
      rowText: { display: 'flex', flexDirection: 'column', gap: '2px' },
      label: { fontWeight: 500 },
      hint: { margin: 0, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5, fontSize: '12px' },
      sectionTitle: { margin: 0, fontSize: '13px', fontWeight: 600 },
      input: {
        width: '120px',
        padding: '6px 8px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        fontVariantNumeric: 'tabular-nums',
      },
      button: {
        padding: '6px 12px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        cursor: 'pointer',
      },
      primary: {
        borderColor: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-brand-primary)',
      },
      danger: {
        borderColor: 'var(--dsw-alias-state-error-primary)',
        color: 'var(--dsw-alias-state-error-primary)',
      },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
      th: {
        textAlign: 'left',
        padding: '6px 8px',
        fontWeight: 500,
        color: 'var(--dsw-alias-label-secondary)',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        whiteSpace: 'nowrap',
      },
      td: {
        padding: '8px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        verticalAlign: 'middle',
      },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' },
      pill: {
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: '999px',
        fontSize: '11px',
        lineHeight: '18px',
        whiteSpace: 'nowrap',
      },
      error: {
        margin: 0,
        padding: '8px 10px',
        borderRadius: '6px',
        color: 'var(--dsw-alias-state-error-primary)',
        border: '1px solid var(--dsw-alias-state-error-primary)',
        lineHeight: 1.5,
      },
      okText: { margin: 0, color: 'var(--dsw-alias-state-success-primary)', lineHeight: 1.5 },
      actions: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' },
      empty: {
        margin: 0,
        padding: '16px',
        textAlign: 'center',
        color: 'var(--dsw-alias-label-secondary)',
        border: '1px dashed var(--dsw-alias-border-l2)',
        borderRadius: '8px',
      },
    }

    /** A labelled toggle that behaves like the host's switches. */
    function Toggle({ checked, onChange, disabled, label }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        disabled,
        onClick: () => onChange(!checked),
        style: {
          position: 'relative',
          flex: '0 0 auto',
          width: '36px',
          height: '20px',
          padding: 0,
          borderRadius: '999px',
          border: '1px solid ' + (checked
            ? 'var(--dsw-alias-brand-primary)'
            : 'var(--dsw-alias-border-l2)'),
          background: checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-base)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          transition: 'background 120ms',
        },
      }, h('span', {
        'aria-hidden': true,
        style: {
          position: 'absolute',
          top: '2px',
          left: checked ? '18px' : '2px',
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          background: checked
            ? 'var(--dsw-alias-bg-base)'
            : 'var(--dsw-alias-label-secondary)',
          transition: 'left 120ms',
        },
      }))
    }

    /**
     * A token field that commits on blur or Enter, never per keystroke.
     *
     * Every commit is a persisted configuration write, so saving as the user
     * types would write the profile once per character.
     */
    function TokenInput({ label, value, onCommit, disabled, style }) {
      const [text, setText] = React.useState(formatTokens(value))
      const [focused, setFocused] = React.useState(false)
      // Re-sync from the Host whenever the saved value changes and the field is
      // not being edited, so a save round-trip cannot leave stale text behind.
      React.useEffect(() => {
        if (!focused) setText(formatTokens(value))
      }, [value, focused])

      const commit = () => {
        const parsed = parseTokens(text)
        if (parsed === undefined || parsed === value) {
          setText(formatTokens(value))
          return
        }
        onCommit(parsed)
      }

      return h('input', {
        type: 'text',
        inputMode: 'numeric',
        value: text,
        disabled,
        'aria-label': label,
        style: style ?? styles.input,
        onFocus: () => setFocused(true),
        onChange: event => setText(event.target.value),
        onBlur: () => { setFocused(false); commit() },
        onKeyDown: event => {
          if (event.key !== 'Enter') return
          event.currentTarget.blur()
        },
      })
    }

    /** One numeric field with a label and hint. */
    function NumberField({ label, hint, value, onChange, disabled }) {
      return h('div', { style: styles.row },
        h('div', { style: styles.rowText },
          h('span', { style: styles.label }, label),
          h('p', { style: styles.hint }, hint),
        ),
        h(TokenInput, { label, value, onCommit: onChange, disabled }),
      )
    }

    /** The settings page. */
    function SurchargeGuardSection({ t }) {
      const [state, setState] = React.useState({ status: 'loading' })
      const [models, setModels] = React.useState({ status: 'idle', rows: [] })
      const [draft, setDraft] = React.useState(undefined)
      const [notice, setNotice] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(async () => {
        setState({ status: 'loading' })
        try {
          const body = await fetchJson('/state')
          setState({ status: 'ready', ...body })
          setDraft(body.config)
        } catch (error) {
          setState({ status: 'failed', error: String(error.message ?? error) })
        }
      }, [])

      const loadModels = React.useCallback(async () => {
        setModels(current => ({ ...current, status: 'loading' }))
        try {
          const body = await fetchJson('/models')
          setModels({ status: 'ready', rows: body.models })
        } catch (error) {
          setModels({ status: 'failed', rows: [], error: String(error.message ?? error) })
        }
      }, [])

      React.useEffect(() => { load() }, [load])
      React.useEffect(() => { loadModels() }, [loadModels])

      const save = React.useCallback(async next => {
        setBusy(true)
        setNotice(undefined)
        try {
          const body = await fetchJson('/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(next),
          })
          setDraft(body.config)
          setState(current => ({ ...current, config: body.config }))
          setNotice({ kind: 'ok', text: t('saved') })
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('saveFailed')}: ${String(error.message ?? error)}` })
        } finally {
          setBusy(false)
        }
      }, [t])

      if (state.status === 'loading') {
        return h('div', { style: styles.page }, h('p', { style: styles.hint }, t('loading')))
      }
      if (state.status === 'failed') {
        return h('div', { style: styles.page },
          h('p', { role: 'alert', style: styles.error }, `${t('loadFailed')}: ${state.error}`),
          h('div', { style: styles.actions },
            h('button', { type: 'button', style: styles.button, onClick: load }, t('retry')),
          ),
        )
      }

      const config = draft ?? state.config
      const writable = state.writable === true && !busy
      const families = state.families ?? []
      const familyLabel = family => t(`family${family.id.charAt(0).toUpperCase()}${family.id.slice(1)}`) || family.id

      /** Rule lookup by provider/model, so a table row knows if it is guarded. */
      const ruleIndex = new Map(config.rules.map(rule => [`${rule.provider}\u0000${rule.model}`, rule]))

      /** Add one rule if absent; keep an existing threshold. */
      const withRule = (list, row, surchargeAtTokens) => {
        const key = `${row.provider}\u0000${row.model}`
        if (list.some(rule => `${rule.provider}\u0000${rule.model}` === key)) return list
        return [...list, { provider: row.provider, model: row.model, surchargeAtTokens, enabled: true }]
      }

      /** Add every model of one family across all providers. */
      const addFamily = family => {
        let next = config.rules
        for (const row of models.rows) {
          if (row.family !== family.id) continue
          next = withRule(next, row, family.surchargeAtTokens)
        }
        save({ ...config, rules: next })
      }

      /** Remove one rule. */
      const removeRule = rule => {
        save({
          ...config,
          rules: config.rules.filter(entry => (
            entry.provider !== rule.provider || entry.model !== rule.model
          )),
        })
      }

      /** Change one rule's threshold. */
      const setThreshold = (rule, surchargeAtTokens) => {
        save({
          ...config,
          rules: config.rules.map(entry => (
            entry.provider === rule.provider && entry.model === rule.model
              ? { ...entry, surchargeAtTokens }
              : entry
          )),
        })
      }

      /** Toggle one rule. */
      const toggleRule = rule => {
        save({
          ...config,
          rules: config.rules.map(entry => (
            entry.provider === rule.provider && entry.model === rule.model
              ? { ...entry, enabled: !entry.enabled }
              : entry
          )),
        })
      }

      const familyTables = families.map(family => {
        const matched = models.rows.filter(row => row.family === family.id)
        return h('button', {
          key: family.id,
          type: 'button',
          disabled: !writable || matched.length === 0,
          style: { ...styles.button, ...(matched.length === 0 ? { opacity: 0.5 } : {}) },
          onClick: () => addFamily(family),
        }, `${t('addFamily').replace('{family}', familyLabel(family))} (${matched.length})`)
      })

      const unguardedUnknown = models.rows.filter(row => (
        row.family === null && !ruleIndex.has(`${row.provider}\u0000${row.model}`)
      ))

      return h('div', { style: styles.page },
        h('p', { style: styles.intro }, t('intro')),
        notice === undefined ? null : h('p', {
          role: notice.kind === 'error' ? 'alert' : undefined,
          style: notice.kind === 'error' ? styles.error : styles.okText,
        }, notice.text),
        writable ? null : h('p', { style: styles.hint }, t('notWritable')),

        h('div', { style: styles.card },
          h('div', { style: styles.row },
            h('div', { style: styles.rowText },
              h('span', { style: styles.label }, t('enabled')),
              h('p', { style: styles.hint }, t('enabledHint')),
            ),
            h(Toggle, {
              label: t('enabled'),
              checked: config.enabled,
              disabled: !writable,
              onChange: next => save({ ...config, enabled: next }),
            }),
          ),
          h(NumberField, {
            label: t('margin'),
            hint: t('marginHint'),
            value: config.safetyMarginTokens,
            disabled: !writable,
            onChange: next => save({ ...config, safetyMarginTokens: next }),
          }),
          h(NumberField, {
            label: t('maxAttempts'),
            hint: t('maxAttemptsHint'),
            value: config.maxAttempts,
            disabled: !writable,
            onChange: next => save({ ...config, maxAttempts: next }),
          }),
        ),

        h('section', { style: { ...styles.card, gap: '10px' } },
          h('h3', { style: styles.sectionTitle }, t('rules')),
          config.rules.length === 0
            ? h('p', { style: styles.empty }, t('rulesEmpty'))
            : h('table', { style: styles.table },
                h('thead', null, h('tr', null,
                  h('th', { style: styles.th }, t('colProvider')),
                  h('th', { style: styles.th }, t('colModel')),
                  h('th', { style: styles.th }, t('colLine')),
                  h('th', { style: styles.th }, t('cap')),
                  h('th', { style: styles.th }, t('colStatus')),
                  h('th', { style: styles.th }, t('colActions')),
                )),
                h('tbody', null, config.rules.map(rule => {
                  const row = models.rows.find(entry => (
                    entry.provider === rule.provider && entry.model === rule.model
                  ))
                  const triggersAt = Math.max(1, rule.surchargeAtTokens - config.safetyMarginTokens)
                  return h('tr', { key: `${rule.provider}\u0000${rule.model}` },
                    h('td', { style: { ...styles.td, ...styles.mono } }, rule.provider),
                    h('td', { style: styles.td },
                      h('div', null, rule.model),
                      row?.contextWindow === undefined
                        ? null
                        : h('div', { style: styles.hint },
                            `${t('colWindow')} ${formatTokens(row.contextWindow)}`),
                    ),
                    h('td', { style: styles.td },
                      h(TokenInput, {
                        label: `${t('colLine')} ${rule.model}`,
                        value: rule.surchargeAtTokens,
                        disabled: !writable,
                        onCommit: next => setThreshold(rule, next),
                      }),
                    ),
                    h('td', { style: { ...styles.td, ...styles.mono } }, formatTokens(triggersAt)),
                    h('td', { style: styles.td },
                      h('span', {
                        style: {
                          ...styles.pill,
                          color: rule.enabled
                            ? 'var(--dsw-alias-state-success-primary)'
                            : 'var(--dsw-alias-label-secondary)',
                          border: '1px solid currentColor',
                        },
                      }, rule.enabled ? t('on') : t('off')),
                    ),
                    h('td', { style: styles.td },
                      h('div', { style: styles.actions },
                        h('button', {
                          type: 'button',
                          disabled: !writable,
                          style: styles.button,
                          onClick: () => toggleRule(rule),
                        }, rule.enabled ? t('off') : t('on')),
                        h('button', {
                          type: 'button',
                          disabled: !writable,
                          style: { ...styles.button, ...styles.danger },
                          onClick: () => removeRule(rule),
                        }, t('remove')),
                      ),
                    ),
                  )
                })),
              ),
          notice === undefined ? null : null,
        ),

        h('section', { style: { ...styles.card, gap: '10px' } },
          h('h3', { style: styles.sectionTitle }, t('addTitle')),
          h('p', { style: styles.hint }, t('addHint')),
          models.status === 'loading'
            ? h('p', { style: styles.hint }, t('scanning'))
            : models.status === 'failed'
              ? h('p', { role: 'alert', style: styles.error }, `${t('loadFailed')}: ${models.error}`)
              : models.rows.length === 0
                ? h('p', { style: styles.hint }, t('noModels'))
                : null,
          h('div', { style: styles.actions },
            ...familyTables,
            h('button', {
              type: 'button',
              disabled: !writable,
              style: styles.button,
              onClick: loadModels,
            }, t('scan')),
          ),
          unguardedUnknown.length === 0 ? null : h('p', { style: styles.hint }, t('unknownFamily')),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      /** Exposed for the render tests; the shell only reads `inject` and `apply`. */
      __page: SurchargeGuardSection,
      apply(ctx) {
        // Dictionaries first, so the nav label resolves on the first render.
        // `bind` is stable per namespace and reads the active locale at call
        // time, so it can be handed to the component and used in render.
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'surcharge-guard: dictionaries')
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: SECTION_ID,
          order: 65,
          label: () => t('nav'),
        }, () => h(SurchargeGuardSection, { t })))
      },
    }
  },
})
