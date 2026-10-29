/**
 * Failure diagnostics for timing-dependent tests: the page records its
 * recent focus, key, input and selection events and a CodeMirror view's
 * selection changes, and a failing test reports them with the page's focus
 * and selection state through `t.diagnostic`.
 *
 * `view` is a page expression for the view, evaluated in the page.
 */

function record(view) {
  const describe = (node) => {
    if (!node) return null
    if (node === window) return 'window'
    if (node === document) return 'document'
    const element =
      node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
    if (!element) return node.nodeName
    const label = element.getAttribute('aria-label')
    return `${element.tagName}${element.classList.length ? `.${[...element.classList].join('.')}` : ''}${label ? `[${label}]` : ''}${element === node ? '' : ` "${node.data?.slice(0, 20)}"`}`
  }
  window.recentEvents ??= []
  const events = window.recentEvents
  const push = (entry) => {
    events.push({ at: Math.round(performance.now()), ...entry })
    if (events.length > 60) events.shift()
  }
  if (!window.recentEventsOn) {
    window.recentEventsOn = true
    window.describeNode = describe
    for (const type of ['focus', 'blur'])
      window.addEventListener(
        type,
        (event) =>
          push({
            type,
            target: describe(event.target),
            hasFocus: document.hasFocus(),
          }),
        true,
      )
    for (const type of [
      'focusin',
      'focusout',
      'keydown',
      'beforeinput',
      'input',
      'pointerdown',
      'selectionchange',
    ])
      document.addEventListener(
        type,
        (event) => {
          const selection = getSelection()
          push({
            type,
            target: describe(event.target),
            ...(event.key ? { key: event.key } : {}),
            ...(event.inputType ? { input: event.inputType } : {}),
            ...(event.relatedTarget !== undefined
              ? { related: describe(event.relatedTarget) }
              : {}),
            active: describe(document.activeElement),
            page: selection?.anchorNode
              ? [
                  describe(selection.anchorNode),
                  selection.anchorOffset,
                  describe(selection.focusNode),
                  selection.focusOffset,
                ]
              : null,
          })
        },
        true,
      )
  }
  if (!view || view.recordingSelections) return
  view.recordingSelections = true
  const stack = () => {
    const limit = Error.stackTraceLimit
    Error.stackTraceLimit = 24
    const { stack } = new Error()
    Error.stackTraceLimit = limit
    return stack
  }
  const update = view.update.bind(view)
  view.update = (transactions) => {
    for (const transaction of transactions)
      if (transaction.selection || transaction.docChanged)
        push({
          type: 'transaction',
          userEvent:
            transaction.annotation(transaction.constructor.userEvent) ?? null,
          docChanged: transaction.docChanged,
          ranges: transaction.newSelection.ranges.map((range) => [
            range.anchor,
            range.head,
          ]),
          stack: stack()
            .split('\n')
            .slice(2)
            .map((line) => line.trim().replace(/\(?\S+\/([^/\s)]+)\)?$/, '$1'))
            .join(' < '),
        })
    return update(transactions)
  }
}

function snapshot(view) {
  const describe = window.describeNode ?? ((node) => node?.nodeName ?? null)
  const selection = getSelection()
  const cell = document.querySelector('.hibi-lp-cell-editor')
  return {
    hasFocus: document.hasFocus(),
    active: describe(document.activeElement),
    view: view && {
      hasFocus: view.hasFocus,
      readOnly: view.state.readOnly,
      contentEditable: view.contentDOM.contentEditable,
      ranges: view.state.selection.ranges.map((range) => [
        range.anchor,
        range.head,
      ]),
      composing: view.composing,
    },
    cellEditor: cell && {
      text: cell.querySelector('.cm-content')?.textContent,
      focused: cell.contains(document.activeElement),
      hasFocus: cell.querySelector('.cm-content')?.cmTile?.root?.view?.hasFocus,
      readOnly:
        cell.querySelector('.cm-content')?.cmTile?.root?.view?.state.readOnly,
    },
    page: selection?.anchorNode
      ? {
          text: selection.toString().slice(0, 40),
          anchor: [describe(selection.anchorNode), selection.anchorOffset],
          focus: [describe(selection.focusNode), selection.focusOffset],
        }
      : null,
    events: window.recentEvents ?? [],
  }
}

/** Start recording, once per page; the view's selections once per view. */
export const recordEvents = (page, view) =>
  page.evaluate(`(${record})(${view})`)

/** In an `afterEach` hook: when the test failed, report the page's state. */
export async function reportFailure(t, page, view) {
  if (t.passed || !page) return
  const state = await page
    .evaluate(`(${snapshot})(${view})`)
    .catch((reason) => String(reason))
  t.diagnostic(`failure state ${JSON.stringify(state)}`)
}
