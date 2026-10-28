import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { marked } from 'marked'
import { electron, waitForDocumentEditor } from './electron.mjs'
import {
  selectFormattedEngine,
  testFormattedEngines as test,
} from './formatted-engine.mjs'
import { clickMenu, pressShortcut } from './keyboard.mjs'
import { waitForAsync } from './poll.mjs'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const scenarios = [
  {
    name: 'continued adjacent code',
    source: 'a `b`',
    raw: 5,
    pm: 4,
    actions: ['inline-code', 'inline-code'],
    text: 'x`y',
    expected: 'a ``bx`y``',
  },
  {
    name: 'continued inside code',
    source: 'a `bc`',
    raw: 4,
    pm: 4,
    actions: ['inline-code', 'inline-code'],
    text: 'x`y',
    expected: 'a ``bx`yc``',
  },
  {
    name: 'continued padded code',
    source: 'a `` b` ``',
    raw: 7,
    pm: 5,
    actions: ['inline-code', 'inline-code'],
    text: 'x`y',
    expected: 'a ``b`x`y``',
  },
  {
    name: 'continued longer code run',
    source: 'a `b``c`',
    raw: 8,
    pm: 7,
    actions: ['inline-code', 'inline-code'],
    text: 'x`y',
    expected: 'a ```b``cx`y```',
  },
  {
    name: 'code excludes bold',
    source: 'a **bold** b',
    raw: 6,
    pm: 5,
    actions: ['inline-code'],
    text: 'X',
    expected: 'a **bo**`X`**ld** b',
  },
  {
    name: 'code excludes pending marks',
    source: 'plain end',
    raw: 9,
    pm: 10,
    actions: ['bold', 'italic', 'inline-code'],
    text: 'X',
    expected: 'plain end`X`',
  },
  {
    name: 'code off enables bold',
    source: 'a `code` b',
    raw: 5,
    pm: 5,
    actions: ['inline-code', 'bold'],
    text: 'X',
    expected: 'a `co`**X**`de` b',
  },
  {
    name: 'literal star',
    source: 'plain end',
    raw: 9,
    pm: 10,
    actions: ['bold'],
    text: '*',
    expected: 'plain end**\\***',
  },
  {
    name: 'literal entity',
    source: 'plain end',
    raw: 9,
    pm: 10,
    actions: ['bold'],
    text: '&copy;',
    expected: 'plain end**&amp;copy;**',
  },
  {
    name: 'continued backticks',
    source: 'plain end',
    raw: 9,
    pm: 10,
    actions: ['inline-code'],
    text: 'a`b',
    expected: 'plain end``a`b``',
  },
]

test('stored mark review cases through native input and toolbar', {
  timeout: 120000,
}, async (t) => {
  const engine = t.formattedEngine
  const profile = await mkdtemp(join(tmpdir(), 'hibi-stored-marks-'))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await cdp.detach()
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 })
  })
  const page = await app.firstWindow()
  await selectFormattedEngine(app, page, engine)
  const rich = page.getByRole('textbox', {
    name: 'Document editor',
    exact: true,
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  const snapshot = () =>
    page.evaluate(async () => {
      await window.hibi.flushDocumentChanges()
      return (await window.hibi.getDocument()).markdown
    })
  const open = async (name, source, raw, pm) => {
    const file = join(profile, `${name}.md`)
    await writeFile(file, source)
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      })
    }, file)
    await clickMenu(app, 'Open…')
    await waitForAsync(
      page,
      async (name) => (await window.hibi.getDocument()).name === name,
      `${name}.md`,
    )
    await waitForDocumentEditor(app, page)
    await rich.focus()
    await rich.evaluate(
      (element, { engine, raw, pm }) => {
        if (engine === 'codemirror')
          element.cmTile.root.view.dispatch({ selection: { anchor: raw } })
        else element.editor.commands.setTextSelection(pm)
      },
      { engine, raw, pm },
    )
  }
  const action = async (id) => {
    await page.evaluate((id) => {
      const button = document.querySelector(
        `.editor-toolbar [data-toolbar-id="format.${id}"]`,
      )
      if (!button || button.disabled)
        throw new Error(`format action unavailable: ${id}`)
      button.click()
    }, id)
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    )
    await rich.focus()
  }
  const history = async (source, typed) => {
    await pressShortcut(app, `${mod}+z`)
    assert.equal(await snapshot(), source, 'one undo restores exact source')
    await pressShortcut(
      app,
      process.platform === 'win32' ? 'Control+y' : `${mod}+Shift+z`,
    )
    assert.equal(await snapshot(), typed, 'redo restores typed text')
  }
  for (const item of scenarios)
    await t.test(item.name, async () => {
      await open(item.name, item.source, item.raw, item.pm)
      for (const id of item.actions) await action(id)
      await page.keyboard.type(item.text)
      const typed = await snapshot()
      await history(item.source, typed)
      assert.equal(marked.parseInline(typed), marked.parseInline(item.expected))
    })
  for (const cancel of [true, false])
    await t.test(
      `pending marks survive ime ${cancel ? 'cancellation' : 'commit'}`,
      async (t) => {
        const source = 'plain end'
        await open(cancel ? 'cancel' : 'commit', source, 9, 10)
        await action('bold')
        await cdp.send('Input.imeSetComposition', {
          text: '仮',
          selectionStart: 1,
          selectionEnd: 1,
        })
        await waitForAsync(page, () =>
          document
            .querySelector('[aria-label="Document editor"]')
            .textContent.includes('仮'),
        )
        if (cancel) {
          await cdp.send('Input.imeSetComposition', {
            text: '',
            selectionStart: 0,
            selectionEnd: 0,
          })
          await waitForAsync(
            page,
            async (source) =>
              (await window.hibi.getDocument()).markdown === source,
            source,
          )
          await page.keyboard.type('X')
          const typed = await snapshot()
          await history(source, typed)
          assert.equal(
            marked.parseInline(typed),
            marked.parseInline('plain end**X**'),
          )
        } else {
          await cdp.send('Input.insertText', { text: '日本' })
          const typed = await snapshot()
          await history(source, typed)
          await t.test(
            'committed ime text keeps pending bold',
            engine === 'codemirror'
              ? {
                  todo: 'formatted gap action-009: committed ime text keeps pending marks',
                }
              : {},
            () => {
              assert.equal(
                marked.parseInline(typed),
                marked.parseInline('plain end**日本**'),
              )
            },
          )
        }
      },
    )
})
