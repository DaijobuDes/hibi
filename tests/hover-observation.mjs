// Bounded records retain the first 24 and last 72 observations.
const prefix = '__hibi_hover_probe__'
export async function install(page, t, label) {
  const cache = {
    label,
    received: 0,
    dropped: 0,
    clipped: 0,
    observerErrors: 0,
    richProviders: 0,
    sourceProviders: 0,
    lastSourceProvider: null,
    rows: [],
    firstReceipt: null,
    lastReceipt: null,
  }
  const collect = (message) => {
    try {
      const text = message.text()
      if (!text.startsWith(prefix)) return
      const row = JSON.parse(text.slice(prefix.length))
      const now = Date.now()
      cache.firstReceipt ??= now
      cache.lastReceipt = now
      cache.received++
      if (row[1] === 'clip') cache.clipped++
      if (row[1] === 'observer-error') cache.observerErrors++
      if (row[1] === 'provider' && row[2] === 'rich') cache.richProviders++
      if (row[1] === 'provider' && row[2] === 'source') {
        cache.sourceProviders++
        cache.lastSourceProvider = row[0]
      }
      if (cache.rows.length === 96) {
        cache.rows.splice(24, 1)
        cache.dropped++
      }
      cache.rows.push(row)
    } catch {}
  }
  page.on('console', collect)
  await page.evaluate(
    ({ prefix }) => {
      const encoder = new TextEncoder()
      const desc = (node) =>
        node instanceof Element
          ? [
              node.tagName.toLowerCase(),
              node.id,
              node.getAttribute('role'),
              typeof node.className === 'string' ? node.className : '',
            ]
              .filter(Boolean)
              .join(':')
              .slice(0, 24)
          : node === window
            ? 'window'
            : node === document
              ? 'document'
              : ''
      const put = (kind, ...fields) => {
        try {
          const row = [
            Date.now(),
            kind,
            ...fields.map((x) => (typeof x === 'string' ? x.slice(0, 32) : x)),
          ]
          let text = JSON.stringify(row)
          if (encoder.encode(text).length > 160)
            text = JSON.stringify([Date.now(), 'clip', kind])
          console.debug(prefix + text)
        } catch {}
      }
      const source = () =>
        document.querySelector('.cm-content[contenteditable="true"]')
      const target = () =>
        document.querySelector(
          'button[data-tooltip="shared help"], button[data-tooltip="updated help"]',
        )
      const rect = (name, node) => {
        if (!node) return
        const r = node.getBoundingClientRect()
        put(
          name,
          ...[r.x, r.y, r.width, r.height].map((x) => Math.round(x * 10) / 10),
        )
      }
      const state = () => {
        const s = source(),
          a = target(),
          selected = getSelection()
        const tips = [...document.querySelectorAll('[role="tooltip"]')]
        const menus = [...document.querySelectorAll('[role="menu"]')]
        // Focus, visibility, hover, popup counts, and DOM selection offsets.
        put(
          'state',
          document.hasFocus(),
          document.hidden,
          desc(document.activeElement),
          a?.matches(':hover') ?? false,
          s?.matches(':hover') ?? false,
          s === document.activeElement,
          tips.length,
          tips.filter((n) => n.matches(':popover-open')).length,
          menus.length,
          menus.filter((n) => n.matches(':popover-open')).length,
          selected?.anchorOffset ?? -1,
          selected?.focusOffset ?? -1,
        )
        if (a)
          put(
            'anchor',
            a.isConnected,
            a.hidden,
            a.inert,
            a.getAttribute('style') ?? '',
            a.getAttribute('data-tooltip') ?? '',
          )
        if (s)
          put(
            'source',
            s.isConnected,
            s.getAttribute('contenteditable'),
            s.closest('[inert], [hidden], [aria-hidden="true"]') !== null,
          )
        rect('sourceRect', s)
        rect('lineRect', s?.querySelector('.cm-line'))
        rect('anchorRect', a)
      }
      const event = (e) => {
        try {
          const pointer = e instanceof PointerEvent
          const hit = pointer
            ? document.elementFromPoint(e.clientX, e.clientY)
            : null
          put(
            e.type,
            desc(e.target),
            pointer ? e.buttons : null,
            pointer ? Math.round(e.clientX) : null,
            pointer ? Math.round(e.clientY) : null,
            desc(hit),
            e instanceof KeyboardEvent ? e.key : '',
          )
          if (
            (pointer && e.type === 'pointermove') ||
            [
              'focusin',
              'focusout',
              'blur',
              'scroll',
              'selectionchange',
              'hibi:source-caret',
              'hibi:editor-interactions-invalidate',
            ].includes(e.type)
          )
            state()
        } catch (error) {
          put('observer-error', e.type, String(error))
        }
      }
      for (const type of [
        'pointerover',
        'pointermove',
        'pointerout',
        'pointerdown',
        'focusin',
        'focusout',
        'keydown',
        'selectionchange',
        'scroll',
        'visibilitychange',
        'hibi:source-caret',
        'hibi:editor-interactions-invalidate',
      ])
        document.addEventListener(type, event, { capture: true, passive: true })
      window.addEventListener('blur', event, { capture: true, passive: true })
      const observer = new MutationObserver((records) => {
        try {
          for (const r of records) {
            if (
              r.type === 'attributes' &&
              r.target instanceof Element &&
              r.target.matches(
                '[data-tooltip], [role="tooltip"], [role="menu"], .cm-content',
              )
            ) {
              put(
                'attr',
                desc(r.target),
                r.attributeName,
                r.target.getAttribute(r.attributeName) ?? '',
              )
              state()
            }
            if (r.type === 'childList')
              for (const n of [...r.addedNodes, ...r.removedNodes])
                if (
                  n instanceof Element &&
                  (n.matches('[role="tooltip"], [role="menu"], .cm-content') ||
                    n.querySelector(
                      '[role="tooltip"], [role="menu"], .cm-content',
                    ))
                ) {
                  put('panel', desc(n), n.isConnected)
                  state()
                }
          }
        } catch (error) {
          put('observer-error', 'mutation', String(error))
        }
      })
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          'hidden',
          'inert',
          'style',
          'aria-hidden',
          'data-tooltip',
          'contenteditable',
        ],
      })
      window.__hibiHoverProbe = { record: put }
      try {
        put('ready')
        state()
      } catch (error) {
        put('observer-error', 'setup', String(error))
      }
    },
    { prefix },
  )
  let reported = false
  const report = () => {
    if (reported) return
    reported = true
    try {
      page.off('console', collect)
      let text = JSON.stringify(cache)
      while (Buffer.byteLength(text) > 16384 && cache.rows.length > 24) {
        cache.rows.splice(24, 1)
        cache.dropped++
        cache.clipped++
        text = JSON.stringify(cache)
      }
      t.diagnostic(`hover-observation ${text}`)
    } catch {}
  }
  const finish = () => report()
  finish.report = report
  return finish
}
export function phase(t, label) {
  t.diagnostic(`hover-phase ${Date.now()} ${label}`)
}
