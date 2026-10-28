import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { countText } from '../src/addons/word-count/count.ts'
import { electron, waitForDocumentEditor } from './electron.mjs'
import { customBodyBoldCases } from './fixtures/custom-body.mjs'
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
    gap: 'formatted gap corpus-022: custom alert and subtext bodies must preserve native italic parsing',
  },
  {
    feature: 'markdown.strike',
    bodies: [
      ['> [!TIP]\n> ~~gone~~', 'gone'],
      ['-# small ~~words~~', 'small words'],
    ],
    gap: 'formatted gap corpus-023: custom alert and subtext bodies must preserve native strike parsing',
  },
  {
    feature: 'core.links',
    bodies: [
      ['> [!TIP]\n> [a](https://b.test)', 'a'],
      ['-# small [a](https://b.test)', 'small a'],
    ],
    gap: 'formatted gap corpus-024: custom alert and subtext bodies must preserve native link parsing',
  },
  {
    feature: 'core.heading-1',
    bodies: [['> [!TIP]\n> # head', 'head']],
    gap: 'formatted gap corpus-025: custom alert bodies must preserve native heading parsing',
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
  const render = async (feature, source, counted) => {
    await page.evaluate((feature) => {
      localStorage.setItem(
        'hibi:markdown-syntax-disabled',
        JSON.stringify(feature ? [feature] : []),
      )
    }, feature)
    await page.reload()
    await waitForDocumentEditor(app, page)
    const file = join(profile, `body-${index++}.md`)
    await writeFile(file, `${source}\n\ntail`)
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
      `${source}\n\ntail`,
    )
    if (counted !== undefined) {
      const totals = countText(`${counted}\ntail`)
      const expected = `${totals.words} words · ${totals.characters} characters`
      await page.waitForFunction(
        (label) =>
          document.querySelector('[data-status-id="word-count.total"]')
            ?.textContent === label,
        expected,
      )
    }
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
            const parts = []
            for (const child of element.children) {
              if (child.classList.contains('hibi-lp-alert-title')) continue
              let text = child.innerText ?? ''
              for (const marker of child.querySelectorAll(
                '.hibi-lp-list-marker',
              ))
                text = text.replace(marker.innerText, '')
              parts.push(text)
            }
            const text = parts.join(' ')
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
            `${text} tail`,
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
  for (const fixture of customBodyBoldCases)
    await t.test(`nested bold scope: ${fixture.name}`, async () => {
      assert.equal(
        await render('core.bold', fixture.source, fixture.text),
        `${fixture.text}\n\ntail`.replace(/\s+/g, ' ').trim(),
        fixture.source,
      )
      assert.equal(
        await page
          .locator('.rich-pane .hibi-lp-strong, .rich-pane strong')
          .count(),
        0,
      )
    })

  if (t.formattedEngine === 'codemirror') {
    await t.test(
      'task items keep their literal view and count scope',
      async () => {
        assert.equal(
          await render(
            'core.bold',
            '> [!TIP]\n> - [ ] **x** y',
            '\n\n\n**x** y',
          ),
          '**x** y tail',
        )
      },
    )
    await t.test(
      'table cell editors keep the enclosing custom body scope',
      async () => {
        const fixture = customBodyBoldCases.find(
          (entry) => entry.name === 'table / bold',
        )
        await render('core.bold', fixture.source, fixture.text)
        await page.locator('.rich-pane td').first().click()
        const cell = page.getByRole('textbox', {
          name: 'Table cell',
          exact: true,
        })
        await cell.evaluate((element) => {
          const view = element.cmTile.root.view
          view.dispatch({ selection: { anchor: view.state.doc.length } })
        })
        await page.waitForFunction(() => {
          const element = document.querySelector(
            '.hibi-lp-cell-editor .cm-content',
          )
          return element?.innerText.trim() === 'x'
        })
        assert.equal(await cell.locator('.hibi-lp-strong').count(), 0)
        assert.match(
          await cell.evaluate((element) =>
            element.cmTile.root.view.state.doc.toString(),
          ),
          /\*\*x\*\*/,
        )
      },
    )
  }

  const directListGap =
    'formatted gap corpus-028: alerts directly in list items must retain native body parsing and counts'
  for (const [name, feature, source, text, gap] of [
    [
      'native task item in alert',
      'core.bold',
      '> [!TIP]\n> - [ ] **x** y',
      '\n\n\nx y',
      'formatted gap corpus-027: task items inside alerts must retain native bold parsing and counts',
    ],
    [
      'native alert in bullet item',
      '',
      '- > [!TIP]\n  > **x** y',
      '\n\n**x** y',
      directListGap,
    ],
    [
      'native alert in ordered item',
      '',
      '1. > [!TIP]\n   > **x** y',
      '\n\n\n\n\n\nx y',
      directListGap,
    ],
  ])
    await t.test(
      name,
      { todo: t.formattedEngine === 'codemirror' ? gap : false },
      async () => {
        assert.equal(
          await render(feature, source, text),
          `${text}\ntail`.replace(/\s+/g, ' ').trim(),
          source,
        )
      },
    )
})
