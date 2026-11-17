/**
 * dsh-surcharge-guard — Client half.
 *
 * Renders the plugin's own configuration on its bundle page in **Plugins**
 * (`plugins.bundle.config`, keyed by this package's name), between the
 * description and the rows.
 *
 * The page owns the form: it passes a `ConfigPageForm` (`state` plus `mutate`),
 * so this half keeps no configuration copy and owns no HTTP route. A write
 * lands in the same volatile fields the Host half reads on the next step. The
 * model catalog comes from the shared `remote` gateway; when it is unavailable
 * the same rules are still editable by hand, and the card renders.
 *
 * @module dsh-surcharge-guard/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-surcharge-guard',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Bundle key, settings namespace and slot key are one string. */
    const NS = 'dsh-surcharge-guard'

    /** Page strings, kept in step with `locale/*.json` by `scripts/check-locale.mjs`. */
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
      "providerAll": "全部服务商",
      "noCatalog": "未读取到模型目录，请确认服务商已配置；规则仍可手动添加。",
      "summaryOff": "计费保护已关闭",
      "summaryNoRules": "已启用，还没有规则",
      "summaryOn": "正在保护 {count} 个模型"
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
      "providerAll": "All providers",
      "noCatalog": "The model catalog is unavailable. Check that a provider is configured; rules can still be added by hand.",
      "summaryOff": "Surcharge guard is off",
      "summaryNoRules": "On, no rules yet",
      "summaryOn": "Guarding {count} models"
}


    /** Token thresholds the providers publish, used to prefill a rule. */
    const FAMILIES = [
      { id: 'gpt', surchargeAtTokens: 272000 },
      { id: 'gemini', surchargeAtTokens: 200000 },
      { id: 'grok', surchargeAtTokens: 200000 },
    ]

    // { getSnapshot(), subscribe(fn), set(field, value), dispose() }

    /** Snapshot used when the page supplies no form (a summary render). */
    const EMPTY_SNAPSHOT = { status: 'unavailable', writable: false, value: undefined }

    /** Compact a token count for display. */
    function formatTokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`
      if (value >= 1000) return `${Math.round(value / 1000)}K`
      return String(value)
    }

    /** Parse `272000`, `272K` and `1.05M`. */
    function parseTokens(text) {
      const raw = String(text).trim().toLowerCase().replace(/[,_\s]/g, '')
      if (raw.length === 0) return undefined
      const match = /^([0-9]*\.?[0-9]+)([km])?$/.exec(raw)
      if (match === null) return undefined
      const base = Number(match[1])
      if (!Number.isFinite(base)) return undefined
      const scale = match[2] === 'm' ? 1000000 : match[2] === 'k' ? 1000 : 1
      const parsed = Math.round(base * scale)
      return parsed > 0 ? parsed : undefined
    }

    /** Whether a value is a live (volatile) reference and not a plain value. */
    const isLive = value => value !== null && typeof value === 'object' && typeof value.get === 'function'

    /** Resolve one field of a form snapshot, unwrapping a live reference. */
    function fieldOf(snapshot, key, fallback) {
      const value = snapshot?.value?.[key]
      if (value === undefined) return fallback
      return isLive(value) ? value.get() : value
    }

    /** The styles; only `--dsw-alias-*` tokens, so light/dark follows the host. */
    const styles = {
      root: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        lineHeight: 1.5,
      },
      intro: { margin: 0, color: 'var(--dsw-alias-label-secondary)', maxWidth: '760px' },
      group: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '12px 14px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '10px',
      },
      groupTitle: { fontSize: '13px', fontWeight: 600, margin: 0 },
      row: {
        display: 'grid',
        gridTemplateColumns: 'minmax(120px, 180px) minmax(0, 1fr)',
        alignItems: 'center',
        columnGap: '12px',
        rowGap: '4px',
      },
      label: { color: 'var(--dsw-alias-label-secondary)' },
      control: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', minWidth: 0 },
      field: {
        minWidth: '140px',
        maxWidth: '220px',
        flex: '1 1 140px',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '6px',
        padding: '5px 8px',
        font: 'inherit',
        fontVariantNumeric: 'tabular-nums',
      },
      hint: { color: 'var(--dsw-alias-label-secondary)', margin: 0, gridColumn: '2 / -1' },
      error: { color: 'var(--dsw-alias-state-error-primary)', margin: 0 },
      ok: { color: 'var(--dsw-alias-state-success-primary)', margin: 0 },
      button: {
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '6px',
        padding: '5px 10px',
        font: 'inherit',
        cursor: 'pointer',
      },
      danger: {
        borderColor: 'var(--dsw-alias-state-error-primary)',
        color: 'var(--dsw-alias-state-error-primary)',
      },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
      th: {
        textAlign: 'left',
        padding: '5px 8px',
        fontWeight: 500,
        color: 'var(--dsw-alias-label-secondary)',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        whiteSpace: 'nowrap',
      },
      td: {
        padding: '7px 8px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        verticalAlign: 'middle',
      },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' },
      empty: {
        margin: 0,
        padding: '14px',
        textAlign: 'center',
        color: 'var(--dsw-alias-label-secondary)',
        border: '1px dashed var(--dsw-alias-border-l2)',
        borderRadius: '8px',
      },
      actions: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' },
    }

    /** One labeled field row. */
    function Row({ label, hint, children }) {
      return h('div', { style: styles.row },
        h('span', { style: styles.label }, label),
        h('div', { style: styles.control }, children),
        hint === undefined ? null : h('p', { style: styles.hint }, hint),
      )
    }

    /** A switch that behaves like the host's. */
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
          border: `1px solid ${checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
          background: checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-base)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
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
          background: checked ? 'var(--dsw-alias-bg-base)' : 'var(--dsw-alias-label-secondary)',
        },
      }))
    }

    /**
     * A token field that commits on blur or Enter, never per keystroke.
     *
     * Each commit is a persisted write, so saving while the user types would
     * write the profile once per character.
     */
    function TokenInput({ label, value, onCommit, disabled, style }) {
      const [text, setText] = React.useState(formatTokens(value))
      const [focused, setFocused] = React.useState(false)
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
        style: style ?? styles.field,
        onFocus: () => setFocused(true),
        onChange: event => setText(event.target.value),
        onBlur: () => { setFocused(false); commit() },
        onKeyDown: event => {
          if (event.key !== 'Enter') return
          event.currentTarget.blur()
        },
      })
    }

    /** Resolve the `remote` gateway face that serves the model catalog. */
    function remoteOf(ctx) {
      for (const name of ['remote.session', 'remote']) {
        let candidate
        try {
          candidate = ctx.get(name)
        } catch {
          candidate = undefined
        }
        if (candidate === undefined || candidate === null) continue
        const session = candidate.session ?? candidate
        if (typeof session?.modelCatalog === 'function') return session
      }
      return undefined
    }

    /** Read the catalog into a flat, family-tagged list. */
    async function loadCatalog(ctx) {
      const remote = remoteOf(ctx)
      if (remote === undefined) return { rows: [], reason: 'unavailable' }
      const answer = await remote.modelCatalog()
      if (answer === null || typeof answer !== 'object' || answer.ok !== true) {
        return { rows: [], reason: answer?.error?.message ?? 'failed' }
      }
      const rows = []
      const value = answer.value
      // The gateway answers either a flat list or provider groups; accept both.
      const groups = Array.isArray(value) ? value : Array.isArray(value?.providers) ? value.providers : []
      for (const group of groups) {
        const provider = group.provider ?? group.id
        const providerName = group.providerName ?? group.name ?? provider
        for (const model of group.models ?? []) {
          const id = model.id ?? model.model
          if (typeof provider !== 'string' || typeof id !== 'string') continue
          const lower = id.toLowerCase()
          const family = /(^|[-_/:])gpt/.test(lower)
            ? 'gpt'
            : lower.includes('gemini')
              ? 'gemini'
              : lower.includes('grok')
                ? 'grok'
                : null
          rows.push({
            provider,
            providerName,
            model: id,
            name: model.name ?? id,
            contextWindow: model.contextWindow ?? model.context?.contextWindow,
            family,
          })
        }
      }
      return { rows, reason: undefined }
    }

    /**
     * The card.
     *
     * The page owner hands over `form` as a `ConfigPageForm`:
     * `{ state: ConfigFormSnapshot, mutate(ops, revision?) }`. `state` is a
     * plain snapshot, not a subscribable store, so the page re-renders this
     * entry itself when the namespace changes.
     */
    function Panel({ t, ctx, form }) {
      const snapshot = form?.state ?? EMPTY_SNAPSHOT
      const [catalog, setCatalog] = React.useState({ status: 'idle', rows: [] })
      const [notice, setNotice] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)

      const reloadCatalog = React.useCallback(() => {
        setCatalog(current => ({ ...current, status: 'loading' }))
        loadCatalog(ctx).then(
          result => setCatalog({ status: 'ready', rows: result.rows, reason: result.reason }),
          error => setCatalog({ status: 'failed', rows: [], reason: String(error?.message ?? error) }),
        )
      }, [ctx])

      React.useEffect(() => { reloadCatalog() }, [reloadCatalog])

      const writable = form !== undefined && snapshot.writable === true
      const enabled = fieldOf(snapshot, 'enabled', true) !== false
      const margin = fieldOf(snapshot, 'safetyMarginTokens', 20000)
      const maxAttempts = fieldOf(snapshot, 'maxAttempts', 2)
      const rules = fieldOf(snapshot, 'rules', [])

      // `view: 'summary'` is the collapsed one-liner; it needs no controls.
      if (form === undefined) {
        return h('p', { style: styles.error }, t('notWritable'))
      }
      if (snapshot.status === 'loading') {
        return h('p', { style: styles.intro }, t('loading'))
      }
      if (snapshot.status === 'unavailable') {
        return h('p', { style: styles.error }, t('notWritable'))
      }

      /**
       * Persist one field, reporting a refusal instead of claiming success.
       *
       * One `set` op per field keeps the write atomic under the page's revision
       * fence: a stale read is refused rather than overwriting a newer edit.
       */
      const write = async (field, value) => {
        if (form === undefined || typeof form.mutate !== 'function') {
          setNotice({ kind: 'error', text: t('notWritable') })
          return
        }
        setBusy(true)
        setNotice(undefined)
        try {
          const accepted = await form.mutate([{ op: 'set', path: [field], value }])
          if (accepted === false) setNotice({ kind: 'error', text: t('saveFailed') })
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('saveFailed')}: ${String(error?.message ?? error)}` })
        } finally {
          setBusy(false)
        }
      }

      const ruleKey = rule => `${rule.provider}\u0000${rule.model}`
      const ruleIndex = new Map(rules.map(rule => [ruleKey(rule), rule]))

      /** Add every catalog model of one family that has no rule yet. */
      const addFamily = family => {
        let next = [...rules]
        for (const row of catalog.rows) {
          if (row.family !== family.id) continue
          if (next.some(rule => ruleKey(rule) === ruleKey(row))) continue
          next = [...next, { provider: row.provider, model: row.model, surchargeAtTokens: family.surchargeAtTokens, enabled: true }]
        }
        if (next.length !== rules.length) void write('rules', next)
      }

      const removeRule = rule => {
        void write('rules', rules.filter(entry => ruleKey(entry) !== ruleKey(rule)))
      }

      const setThreshold = (rule, surchargeAtTokens) => {
        void write('rules', rules.map(entry => (
          ruleKey(entry) === ruleKey(rule) ? { ...entry, surchargeAtTokens } : entry
        )))
      }

      const toggleRule = rule => {
        void write('rules', rules.map(entry => (
          ruleKey(entry) === ruleKey(rule) ? { ...entry, enabled: !entry.enabled } : entry
        )))
      }

      const familyLabel = id => t(`family${id.charAt(0).toUpperCase()}${id.slice(1)}`)

      return h('div', { style: styles.root },
        h('p', { style: styles.intro }, t('intro')),
        notice === undefined ? null : h('p', {
          role: notice.kind === 'error' ? 'alert' : undefined,
          style: notice.kind === 'error' ? styles.error : styles.ok,
        }, notice.text),
        writable ? null : h('p', { style: styles.error }, t('notWritable')),

        h('div', { style: styles.group },
          h('div', { style: styles.row },
            h('span', { style: styles.label }, t('enabled')),
            h('div', { style: styles.control },
              h(Toggle, {
                label: t('enabled'),
                checked: enabled,
                disabled: !writable || busy,
                onChange: next => write('enabled', next),
              }),
            ),
            h('p', { style: styles.hint }, t('enabledHint')),
          ),
          h(Row, { label: t('margin'), hint: t('marginHint') },
            h(TokenInput, {
              label: t('margin'),
              value: margin,
              disabled: !writable || busy,
              onCommit: next => write('safetyMarginTokens', next),
            }),
          ),
          h(Row, { label: t('maxAttempts'), hint: t('maxAttemptsHint') },
            h(TokenInput, {
              label: t('maxAttempts'),
              value: maxAttempts,
              disabled: !writable || busy,
              onCommit: next => write('maxAttempts', next),
            }),
          ),
        ),

        h('div', { style: styles.group },
          h('h4', { style: styles.groupTitle }, t('rules')),
          rules.length === 0
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
                h('tbody', null, rules.map(rule => {
                  const row = catalog.rows.find(entry => (
                    entry.provider === rule.provider && entry.model === rule.model
                  ))
                  const triggersAt = Math.max(1, rule.surchargeAtTokens - margin)
                  return h('tr', { key: ruleKey(rule) },
                    h('td', { style: { ...styles.td, ...styles.mono } }, rule.provider),
                    h('td', { style: styles.td },
                      h('div', null, rule.model),
                      row?.contextWindow === undefined
                        ? null
                        : h('div', { style: { ...styles.hint, gridColumn: 'auto' } },
                            `${t('colWindow')} ${formatTokens(row.contextWindow)}`),
                    ),
                    h('td', { style: styles.td },
                      h(TokenInput, {
                        label: `${t('colLine')} ${rule.model}`,
                        value: rule.surchargeAtTokens,
                        disabled: !writable || busy,
                        onCommit: next => setThreshold(rule, next),
                      }),
                    ),
                    h('td', { style: { ...styles.td, ...styles.mono } }, formatTokens(triggersAt)),
                    h('td', { style: styles.td }, rule.enabled === false ? t('off') : t('on')),
                    h('td', { style: styles.td },
                      h('div', { style: styles.actions },
                        h('button', {
                          type: 'button',
                          disabled: !writable || busy,
                          style: styles.button,
                          onClick: () => toggleRule(rule),
                        }, rule.enabled === false ? t('on') : t('off')),
                        h('button', {
                          type: 'button',
                          disabled: !writable || busy,
                          style: { ...styles.button, ...styles.danger },
                          onClick: () => removeRule(rule),
                        }, t('remove')),
                      ),
                    ),
                  )
                })),
              ),
        ),

        h('div', { style: styles.group },
          h('h4', { style: styles.groupTitle }, t('addTitle')),
          h('p', { style: { ...styles.intro, padding: 0 } }, t('addHint')),
          catalog.status === 'loading' ? h('p', { style: styles.intro }, t('scanning')) : null,
          catalog.status === 'failed'
            ? h('p', { role: 'alert', style: styles.error }, `${t('loadFailed')}: ${catalog.reason}`)
            : null,
          catalog.status === 'ready' && catalog.rows.length === 0
            ? h('p', { style: styles.intro }, catalog.reason === 'unavailable' ? t('noCatalog') : t('noModels'))
            : null,
          h('div', { style: styles.actions },
            ...FAMILIES.map(family => {
              const matched = catalog.rows.filter(row => row.family === family.id)
              return h('button', {
                key: family.id,
                type: 'button',
                disabled: !writable || busy || matched.length === 0,
                style: { ...styles.button, ...(matched.length === 0 ? { opacity: 0.5 } : {}) },
                onClick: () => addFamily(family),
              }, `${t('addFamily').replace('{family}', familyLabel(family.id))} (${matched.length})`)
            }),
            h('button', {
              type: 'button',
              style: styles.button,
              onClick: reloadCatalog,
            }, t('scan')),
          ),
        ),
      )
    }

    /**
     * The slot component.
     *
     * The page asks for one of two views of the same entry: `summary` is the
     * one-liner drawn in the plugin list, `page` is the body of the plugin's own
     * page. Rendering the whole form for `summary` would stretch every row of
     * the list, so the two are separate components.
     */
    const Card = props => {
      const t = props.t ?? clientCtx.locale.bind(NS)
      if (props.view === 'summary') return h(Summary, { t, form: props.form })
      return h(Panel, { t, ctx: clientCtx, form: props.form })
    }

    /**
     * The one-liner the plugin list draws for this entry.
     *
     * States the guard's current posture in one sentence, so the list answers
     * "is this on, and how many models are guarded" without opening the page.
     */
    function Summary({ t, form }) {
      const snapshot = form?.state ?? EMPTY_SNAPSHOT
      if (snapshot.status === 'loading') return h('span', null, t('loading'))
      if (snapshot.status !== 'ready') return h('span', null, t('notWritable'))
      if (fieldOf(snapshot, 'enabled', true) === false) return h('span', null, t('summaryOff'))
      const rules = fieldOf(snapshot, 'rules', [])
      const active = rules.filter(rule => rule.enabled !== false).length
      if (active === 0) return h('span', null, t('summaryNoRules'))
      return h('span', null, t('summaryOn').replace('{count}', String(active)))
    }

    let clientCtx

    return {
      inject: ['slots', 'locale'],
      /** Exposed for the render tests; the shell reads only `inject` and `apply`. */
      __page: Panel,
      __summary: Summary,
      apply(ctx) {
        clientCtx = ctx
        // Dictionaries first, so the card's text resolves on the first render.
        clientCtx.effect(() => clientCtx.locale.register(NS, { zh, en }), 'surcharge-guard: dictionaries')
        const t = clientCtx.locale.bind(NS)

        // Keyed by this package's name: the card renders on this bundle's page in
        // Plugins, between its description and its rows.
        clientCtx.slots.inject('plugins.bundle.config', () => clientCtx.slots.register({
          name: 'plugins.bundle.config',
          key: NS,
          locale: NS,
        }, Card))
      },
    }
  },
})
