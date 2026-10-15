const prefix = '__hibi_close_focus__'
const slot = '__hibiCloseFocusTrace'

export async function installCloseFocusTrace(page, t) {
  const cache = {
    setup: 'pending',
    restore: 'pending',
    privateActiveTab: 'unmeasured',
    received: 0,
    dropped: 0,
    clipped: 0,
    observerErrors: 0,
    hideCalls: 0,
    focusCalls: 0,
    framesQueued: 0,
    framesRun: 0,
    hideEntry: null,
    hideExit: null,
    firstReceipt: null,
    lastReceipt: null,
    rows: [],
  }
  let reported = false
  const collect = (message) => {
    try {
      const text = message.text()
      if (!text.startsWith(prefix)) return
      const row =
        Buffer.byteLength(text) > Buffer.byteLength(prefix) + 160
          ? [0, 'clip', 'transport-oversize']
          : JSON.parse(text.slice(prefix.length))
      const kind = row[1] === 'clip' ? row[2] : row[1]
      cache.received++
      cache.firstReceipt ??= Date.now()
      cache.lastReceipt = Date.now()
      if (row[1] === 'clip') cache.clipped++
      if (kind === 'observer-error') cache.observerErrors++
      if (kind === 'hide:before') {
        cache.hideCalls++
        cache.hideEntry = row
      }
      if (kind === 'hide:after') cache.hideExit = row
      if (kind === 'focus:before') cache.focusCalls++
      if (kind === 'raf:queued') cache.framesQueued++
      if (kind === 'raf:before') cache.framesRun++
      if (cache.rows.length === 64) {
        cache.rows.splice(16, 1)
        cache.dropped++
      }
      cache.rows.push(row)
    } catch {
      cache.observerErrors++
    }
  }
  page.on('console', collect)
  try {
    cache.setup = await page.evaluate(
      ({ prefix, slot }) => {
        const doc = document,
          handle = window.viewsFixture.handles.tab
        if (slot in window) throw new Error('focus probe slot occupied')
        const hide = handle.hide,
          frame = window.requestAnimationFrame
        const focus = HTMLElement.prototype.focus,
          saved = [],
          listeners = []
        const encoder = new TextEncoder()
        let active = true,
          sequence = 0,
          hideDepth = 0,
          hideOwner = null
        const tab = () => doc.getElementById('addon-tab-' + handle.id)
        const editable = () =>
          doc.querySelector(
            '.editor-panes .rich-pane:not([inert]) [contenteditable="true"], .editor-panes .source-pane:not([inert]) [contenteditable="true"]',
          )
        const who = (node) => {
          if (node === window) return 'window'
          if (node === doc.body) return 'body'
          if (!(node instanceof Element)) return 'none'
          if (tab()?.parentElement?.contains(node)) return 'closing-tab'
          if (node.closest('[data-addon-view="' + CSS.escape(handle.id) + '"]'))
            return 'closing-view'
          if (node.matches('.tiptap, .cm-content'))
            return (
              (node.matches('.tiptap') ? 'rich:' : 'source:') +
              (node.closest('.editor-page')?.getAttribute('data-side') ===
              'right'
                ? 'right'
                : 'left')
            )
          if (node.getAttribute('role') === 'tab') return 'other-tab'
          if (node.closest('.addon-sidebar')) return 'sidebar'
          return node.tagName.toLowerCase().slice(0, 10)
        }
        const bits = (node, measure = false) =>
          node instanceof Element
            ? 1 |
              (node.isConnected ? 2 : 0) |
              (node.closest('[hidden], [inert], [aria-hidden="true"]')
                ? 4
                : 0) |
              (measure &&
              node.getClientRects().length &&
              getComputedStyle(node).visibility !== 'hidden'
                ? 8
                : 0) |
              (node.isContentEditable ? 16 : 0) |
              (node.matches(':disabled') ? 32 : 0) |
              (node.hasAttribute('tabindex') ? 64 : 0) |
              (node === doc.activeElement ? 256 : 0)
            : 0
        const send = (row) => {
          try {
            let text = JSON.stringify(row)
            if (encoder.encode(text).length > 160)
              text = JSON.stringify([performance.now(), 'clip', row[1]])
            console.debug(prefix + text)
          } catch {}
        }
        const put = (
          kind,
          id = 0,
          target = null,
          stamp = null,
          duringHide = false,
          measure = false,
        ) => {
          if (!active) return
          try {
            const current = doc.activeElement
            const selected = doc.querySelector(
              '[id^="addon-tab-"][aria-selected="true"]',
            )
            send([
              Math.round(performance.now()),
              kind,
              id,
              duringHide,
              who(current),
              hideOwner ? current === hideOwner : null,
              doc.hasFocus(),
              selected ? (selected === tab() ? 1 : 2) : 0,
              bits(editable()),
              who(target),
              bits(target, measure),
              measure,
              stamp,
            ])
          } catch {
            send([performance.now(), 'observer-error', kind])
          }
        }
        const change = (owner, key, value) => {
          const descriptor = Object.getOwnPropertyDescriptor(owner, key)
          if (!Reflect.set(owner, key, value))
            throw new Error('focus probe hook not writable')
          saved.push([owner, key, descriptor, value])
        }
        const restore = () => {
          if (!active) return { restored: true, errors: 0 }
          put('stop')
          active = false
          let errors = 0
          for (const [owner, event, listener] of listeners) {
            try {
              owner.removeEventListener(event, listener, true)
            } catch {
              errors++
            }
          }
          for (const [owner, key, descriptor, installed] of saved.reverse()) {
            try {
              if (owner[key] !== installed) {
                errors++
                continue
              }
              if (descriptor) Object.defineProperty(owner, key, descriptor)
              else Reflect.deleteProperty(owner, key)
            } catch {
              errors++
            }
          }
          return { restored: errors === 0, errors }
        }
        const invoke = (
          kind,
          id,
          fn,
          self,
          args,
          target = null,
          stamp = null,
          duringHide = false,
        ) => {
          if (!active) return Reflect.apply(fn, self, args)
          const measure = kind === 'focus'
          put(kind + ':before', id, target, stamp, duringHide, measure)
          try {
            return Reflect.apply(fn, self, args)
          } catch (error) {
            put(kind + ':throw', id, target, stamp, duringHide, measure)
            throw error
          } finally {
            put(kind + ':after', id, target, stamp, duringHide, measure)
          }
        }
        try {
          change(handle, 'hide', function (...args) {
            if (!active) return Reflect.apply(hide, this, args)
            try {
              hideOwner = doc.activeElement
            } catch {
              send([performance.now(), 'observer-error', 'hide-owner'])
            }
            hideDepth++
            try {
              return invoke('hide', 0, hide, this, args)
            } finally {
              hideDepth--
            }
          })
          change(window, 'requestAnimationFrame', function (...args) {
            if (!active || typeof args[0] !== 'function')
              return Reflect.apply(frame, this, args)
            const callback = args[0],
              id = ++sequence,
              duringHide = hideDepth > 0
            args[0] = function (...callbackArgs) {
              return invoke(
                'raf',
                id,
                callback,
                this,
                callbackArgs,
                null,
                typeof callbackArgs[0] === 'number' ? callbackArgs[0] : null,
                duringHide,
              )
            }
            let result
            try {
              result = Reflect.apply(frame, this, args)
            } catch (error) {
              put('raf:queue-throw', id)
              throw error
            }
            put('raf:queued', id, null, null, duringHide)
            return result
          })
          change(HTMLElement.prototype, 'focus', function (...args) {
            return invoke('focus', 0, focus, this, args, this)
          })
          for (const [owner, events] of [
            [doc, ['focusin', 'focusout']],
            [window, ['focus', 'blur']],
          ]) {
            for (const event of events) {
              const listener = (value) => put('event:' + event, 0, value.target)
              owner.addEventListener(event, listener, {
                capture: true,
                passive: true,
              })
              listeners.push([owner, event, listener])
            }
          }
          change(window, slot, { restore })
          put('ready')
          return 'installed'
        } catch (error) {
          restore()
          throw error
        }
      },
      { prefix, slot },
    )
  } catch {
    cache.setup = 'failed'
    cache.observerErrors++
  }
  return {
    report(result) {
      if (reported) return
      reported = true
      try {
        const head = 'addon close focus ' + result + ' '
        let text = JSON.stringify(cache)
        while (
          Buffer.byteLength(head + text) > 15360 &&
          cache.rows.length > 16
        ) {
          cache.rows.splice(16, 1)
          cache.dropped++
          text = JSON.stringify(cache)
        }
        t.diagnostic(head + text)
      } catch {}
    },
    async stop() {
      let timer
      try {
        if (cache.setup !== 'installed') {
          cache.restore = 'not-installed'
          return
        }
        const restore = page
          .evaluate((slot) => window[slot]?.restore(), slot)
          .then((value) => (value?.restored ? 'complete' : 'partial'))
          .catch(() => 'unavailable')
        cache.restore = await Promise.race([
          restore,
          new Promise((resolve) => {
            timer = setTimeout(() => resolve('1000ms-cap'), 1000)
          }),
        ])
      } catch {
        cache.restore = 'unavailable'
      } finally {
        clearTimeout(timer)
        page.off('console', collect)
        try {
          t.diagnostic('addon close focus restore ' + cache.restore)
        } catch {}
      }
    },
  }
}
