import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron, waitForDocumentEditor } from './electron.mjs'
import {
  selectFormattedEngine,
  testFormattedEngines as test,
} from './formatted-engine.mjs'
import { clickMenu } from './keyboard.mjs'

const cases = [
  {
    feature: 'core.italic',
    bodies: [
      ['> [!TIP]\n> *careful*', 'careful'],
      ['-# small *words*', 'small words'],
    ],
    gap: 'formatted gap corpus-020: custom alert and subtext bodies must preserve native italic parsing',
  },
  {
    feature: 'markdown.strike',
    bodies: [
      ['> [!TIP]\n> ~~gone~~', 'gone'],
      ['-# small ~~words~~', 'small words'],
    ],
    gap: 'formatted gap corpus-021: custom alert and subtext bodies must preserve native strike parsing',
  },
  {
    feature: 'core.links',
    bodies: [
      ['> [!TIP]\n> [a](https://b.test)', 'a'],
      ['-# small [a](https://b.test)', 'small a'],
    ],
    gap: 'formatted gap corpus-022: custom alert and subtext bodies must preserve native link parsing',
  },
  {
    feature: 'core.heading-1',
    bodies: [['> [!TIP]\n> # head', 'head']],
    gap: 'formatted gap corpus-023: custom alert bodies must preserve native heading parsing',
  },
]

test('custom body preference scopes match native text', {
  timeout: 180000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-custom-body-'))
  await writeFile(
    join(profile, 'addons.json'),
    JSON.stringify({ 'text-extras': true, markdown: true, 'word-count': true }),
  )
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  await selectFormattedEngine(app, page, t.formattedEngine)
  let index = 0
  const render = async (feature, source) => {
    await page.evaluate((feature) => {
      localStorage.setItem(
        'hibi:markdown-syntax-disabled',
        JSON.stringify([feature]),
      )
    }, feature)
    await page.reload()
    await waitForDocumentEditor(app, page)
    const file = join(profile, `body-${index++}.md`)
    await writeFile(file, source + '\n\ntail')
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      })
    }, file)
    await clickMenu(app, 'Open…')
    await waitForDocumentEditor(app, page)
    await page.waitForFunction(
      async (source) => (await window.hibi.getDocument()).markdown === source,
      source + '\n\ntail',
    )
    const editor = page.getByRole('textbox', {
      name: 'Document editor',
      exact: true,
    })
    return editor.evaluate((element) => {
      if (element.editor) {
        element.editor.commands.setTextSelection(
          element.editor.state.doc.content.size,
        )
        element.blur()
        return element.editor.getText().replace(/\s+/g, ' ').trim()
      }
      const view = element.cmTile.root.view
      view.dispatch({ selection: { anchor: view.state.doc.length } })
      element.blur()
      return new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const text = [...element.querySelectorAll('.cm-line')]
              .filter((line) => !line.classList.contains('hibi-lp-alert-title'))
              .map((line) => {
                const copy = line.cloneNode(true)
                for (const marker of copy.querySelectorAll(
                  '.hibi-lp-list-marker',
                ))
                  marker.remove()
                return copy.textContent
              })
              .join(' ')
            resolve(text.replace(/\s+/g, ' ').trim())
          }),
        ),
      )
    })
  }

  for (const entry of cases)
    await t.test(
      entry.feature,
      { todo: t.formattedEngine === 'codemirror' ? entry.gap : false },
      async () => {
        for (const [source, text] of entry.bodies)
          assert.equal(
            await render(entry.feature, source),
            text + ' tail',
            source,
          )
      },
    )

  for (const [name, source, expected] of [
    ['bullet alert', '- > [!TIP]\n  > **x**', '**x** tail'],
    ['ordered alert', '1. > [!TIP]\n   > **x**', '**x** tail'],
    ['list subtext', '- -# small **words**', 'small words tail'],
  ])
    await t.test(name, async () => {
      assert.equal(await render('core.bold', source), expected)
    })
})
