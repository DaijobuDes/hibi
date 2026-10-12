import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron, waitForDocumentEditor } from './electron.mjs'
import { clickMenu } from './keyboard.mjs'
import { waitForAsync } from './poll.mjs'

test('autocomplete learns locally, disables learning, excludes documents and clears disk through settings and palette', {
  timeout: 90000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-autocomplete-'))
  await writeFile(
    join(profile, 'addons.json'),
    JSON.stringify({ dictionary: true, autocomplete: true }),
  )
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await waitForDocumentEditor(app, page)
  await app.evaluate(({ ipcMain }) => {
    globalThis.autocompleteNetwork = []
    globalThis.fetch = async (input) => {
      globalThis.autocompleteNetwork.push(String(input))
      throw new Error('autocomplete must stay offline')
    }
    ipcMain.removeHandler('host-network:get-text')
    ipcMain.handle('host-network:get-text', (_event, _owner, request) => {
      globalThis.autocompleteNetwork.push(request.url)
      throw new Error('autocomplete must stay offline')
    })
  })
  const rich = page.locator('.rich-pane .tiptap[contenteditable="true"]')
  const settings = async () => {
    await clickMenu(app, 'Settings')
    await page.getByRole('tab', { name: 'Autocomplete', exact: true }).click()
  }
  const back = async () => {
    await page.getByRole('button', { name: /back to app/i }).click()
    await page.locator('.settings-screen').waitFor({ state: 'hidden' })
    await waitForDocumentEditor(app, page)
    await rich.evaluate((element) => element.editor.commands.focus('end'))
  }
  const stored = () =>
    page.evaluate(() =>
      window.hibi.readAddonStorage({
        owner: 'autocomplete',
        scope: { kind: 'global' },
        key: 'learned-words',
        version: 1,
      }),
    )
  const disk = async () =>
    JSON.parse(
      await readFile(
        join(profile, 'addon-storage', 'global', 'autocomplete.json'),
        'utf8',
      ),
    )
  await settings()
  await page
    .getByText('Enable Dictionary and thesaurus to use autocomplete.', {
      exact: false,
    })
    .waitFor({ state: 'hidden' })
  await back()
  await page.keyboard.type('bro that was wild. '.repeat(6))
  await waitForAsync(page, async () => {
    const data = await window.hibi.readAddonStorage({
      owner: 'autocomplete',
      scope: { kind: 'global' },
      key: 'learned-words',
      version: 1,
    })
    return (
      data.status === 'ready' &&
      // Counts begin decaying before the debounced write reaches disk.
      data.value.entries.some((row) => row.word === 'wild' && row.count > 5.99)
    )
  })
  const first = await stored()
  assert.ok(
    first.value.entries.every(
      (row) => row.scope === null && row.context.length <= 2,
    ),
  )
  assert.ok(
    first.value.entries.some(
      (row) => row.word === 'wild' && row.context.join(' ') === 'that was',
    ),
  )
  for (const mode of ['rich', 'source']) {
    if (mode === 'source') {
      await page
        .getByRole('button', { name: 'Source view', exact: true })
        .click()
      await waitForDocumentEditor(app, page, { name: 'Markdown editor' })
    }
    const popup =
      mode === 'rich'
        ? page.getByRole('listbox', { name: 'Completions' })
        : page.locator('.cm-tooltip-autocomplete')
    const waitForChoice = async () => {
      await popup.getByRole('option', { name: 'wild', exact: true }).waitFor()
      if (mode === 'source') {
        // Wait for CodeMirror's actual interaction guard, without a fixed sleep.
        await page.waitForFunction(() => {
          const state =
            document.querySelector('.cm-content')?.cmTile?.root?.view?.state
          const completion = state?.values.find((value) => value?.open?.options)
          const config = state?.config.staticValues.find(
            (value) => typeof value?.interactionDelay === 'number',
          )
          return (
            completion?.open &&
            !completion.open.disabled &&
            config &&
            Date.now() - completion.open.timestamp >= config.interactionDelay
          )
        })
      }
    }
    const reset = async (text) => {
      if (mode === 'rich') {
        await rich.evaluate((element, text) => {
          const editor = element.editor
          editor.commands.setContent(text, { contentType: 'markdown' })
          editor.commands.focus('end')
        }, text)
        await page.waitForFunction(() => {
          const editor = document.querySelector('.rich-pane .tiptap').editor
          const { empty, head } = editor.state.selection
          return (
            editor.view.hasFocus() &&
            empty &&
            head === editor.state.doc.content.size - 1
          )
        })
      } else {
        const source = page.getByRole('textbox', {
          name: 'Markdown editor',
          exact: true,
        })
        await source.focus()
        await source.press(
          process.platform === 'darwin' ? 'Meta+a' : 'Control+a',
        )
        await page.keyboard.insertText(text)
      }
      await page.keyboard.press('Escape')
      await waitForAsync(
        page,
        async (text) => (await window.hibi.getDocument()).markdown === text,
        text,
      )
    }
    await reset('purple zebra')
    await page.keyboard.type(' ')
    await page.keyboard.press('Control+Space')
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    )
    await popup.waitFor({ state: 'hidden' })
    await page.keyboard.press('Enter')
    await page.keyboard.type('new paragraph')
    await waitForAsync(page, async () =>
      /^purple zebra\s*\n+new paragraph$/.test(
        (await window.hibi.getDocument()).markdown,
      ),
    )
    const caret = () =>
      page.evaluate((mode) => {
        if (mode === 'rich') {
          const { anchor, head } =
            document.querySelector('.rich-pane .tiptap').editor.state.selection
          return { anchor, head }
        }
        const { anchor, head } =
          document.querySelector('.cm-content').cmTile.root.view.state.selection
            .main
        return { anchor, head }
      }, mode)
    const waitForCaret = (condition) =>
      waitForAsync(
        page,
        ({ mode, previousHead, expected }) => {
          const { anchor, head } =
            mode === 'rich'
              ? document.querySelector('.rich-pane .tiptap').editor.state
                  .selection
              : document.querySelector('.cm-content').cmTile.root.view.state
                  .selection.main
          return expected
            ? anchor === expected.anchor && head === expected.head
            : head !== previousHead
        },
        { mode, ...condition },
      )
    const openBetweenParagraphs = async () => {
      await reset('previous paragraph\n\nbro that was\n\nfollowing paragraph')
      await page.evaluate((mode) => {
        if (mode === 'rich') {
          const editor = document.querySelector('.rich-pane .tiptap').editor
          editor.commands.setTextSelection(
            editor.state.doc.child(0).nodeSize + 1 + 'bro that was'.length,
          )
        } else {
          const view = document.querySelector('.cm-content').cmTile.root.view
          const head =
            view.state.doc.toString().indexOf('bro that was') +
            'bro that was'.length
          view.dispatch({ selection: { anchor: head } })
        }
      }, mode)
      await page.keyboard.type(' ')
      await waitForChoice()
    }
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      for (const shift of ['', 'Shift+']) {
        await openBetweenParagraphs()
        const before = await caret()
        await page.keyboard.press('Escape')
        await page.keyboard.press(shift + key)
        await waitForCaret({ previousHead: before.head })
        const expected = await caret()
        assert.notEqual(
          expected.head,
          before.head,
          `${mode} ${shift}${key} control moves caret`,
        )
        await openBetweenParagraphs()
        await page.keyboard.press(shift + key)
        await popup.waitFor({ state: 'hidden' })
        await waitForCaret({ expected })
        assert.deepEqual(await caret(), expected, `${mode} ${shift}${key}`)
      }
    }
    for (const dismissWithArrow of [false, true]) {
      await reset('bro that was')
      await page.keyboard.type(' ')
      await waitForChoice()
      assert.equal(await popup.locator('[aria-selected="true"]').count(), 0)
      if (dismissWithArrow) {
        await page.keyboard.press('ArrowDown')
        await popup.waitFor({ state: 'hidden' })
      }
      await page.keyboard.press('Enter')
      await page.keyboard.type('new paragraph')
      await waitForAsync(page, async () =>
        /^bro that was\s*\n+new paragraph$/.test(
          (await window.hibi.getDocument()).markdown,
        ),
      )
    }
    await reset('bro that was')
    await page.keyboard.type(' ')
    await waitForChoice()
    await page.keyboard.press('Tab')
    await popup.waitFor({ state: 'hidden' })
    // Read editor state directly so a delayed document flush cannot hide acceptance.
    const textAfterTab = await page.evaluate(
      (mode) =>
        mode === 'rich'
          ? document.querySelector('.rich-pane .tiptap').editor.state.doc
              .textContent
          : document
              .querySelector('.cm-content')
              .cmTile.root.view.state.doc.toString(),
      mode,
    )
    assert.match(textAfterTab, /^bro that was\s*$/)
    await reset('bro that was wil')
    await page.keyboard.press('Control+Space')
    await waitForChoice()
    await page.keyboard.press('Tab')
    await waitForAsync(
      page,
      async () =>
        (await window.hibi.getDocument()).markdown === 'bro that was wild',
    )
    await reset('bro that was wil')
    await page.keyboard.press('Control+Space')
    await waitForChoice()
    await page.keyboard.press('Enter')
    await page.keyboard.type('new paragraph')
    await waitForAsync(page, async () =>
      /^bro that was wil\n+new paragraph$/.test(
        (await window.hibi.getDocument()).markdown,
      ),
    )
    await reset('bro that was wil')
    await page.keyboard.press('Control+Space')
    await waitForChoice()
    await page.keyboard.press('ArrowDown')
    assert.equal(await popup.locator('[aria-selected="true"]').count(), 1)
    await page.keyboard.press('Enter')
    await waitForAsync(
      page,
      async () =>
        (await window.hibi.getDocument()).markdown === 'bro that was wild',
    )
  }
  await page.getByRole('button', { name: 'normal', exact: true }).click()
  await waitForDocumentEditor(app, page)

  await settings()
  await page.locator('#autocomplete-learning').uncheck()
  await back()
  const positiveWrite = async (word) => {
    await page.keyboard.type(` ${word} `)
    // A real debounced disk write is the positive control for both exclusions.
    await waitForAsync(
      page,
      async (word) => {
        const data = await window.hibi.readAddonStorage({
          owner: 'autocomplete',
          scope: { kind: 'global' },
          key: 'learned-words',
          version: 1,
        })
        return (
          data.status === 'ready' &&
          data.value.entries.some((row) => row.word === word)
        )
      },
      word,
    )
    assert.ok(
      (await disk()).entries['learned-words'].value.entries.some(
        (row) => row.word === word,
      ),
    )
  }
  await page.keyboard.type(' disabledword ')
  // Re-enable learning before the positive control.
  await settings()
  await page.locator('#autocomplete-learning').check()
  await back()
  await positiveWrite('enabledcontrol')
  assert.equal(
    (await disk()).entries['learned-words'].value.entries.some(
      (row) => row.word === 'disabledword',
    ),
    false,
  )
  await settings()
  await page.locator('#autocomplete-exclude-document').check()
  await back()
  await page.keyboard.type(' excludedword ')
  // Re-include this document before the positive control.
  await settings()
  await page.locator('#autocomplete-exclude-document').uncheck()
  await back()
  await positiveWrite('includedcontrol')
  assert.equal(
    (await disk()).entries['learned-words'].value.entries.some(
      (row) => row.word === 'excludedword',
    ),
    false,
  )
  await settings()
  await page.locator('#autocomplete-exclude-document').check()
  await back()

  await settings()
  const clearButton = page
    .getByRole('main', { name: 'Settings' })
    .getByRole('button', { name: 'Clear learned words', exact: true })
  await clearButton.click()
  const confirmation = page.getByRole('dialog', { name: 'Clear learned words' })
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await confirmation.waitFor({ state: 'hidden' })
  assert.ok((await stored()).value.entries.length > 0)
  await clearButton.click()
  await confirmation
    .getByRole('button', { name: 'Clear learned words', exact: true })
    .click()
  await page.getByText('Learned words cleared.', { exact: true }).waitFor()
  assert.deepEqual((await disk()).entries['learned-words'].value.entries, [])
  await page.locator('#autocomplete-exclude-document').uncheck()
  await back()
  await page.keyboard.type('freshword ')
  await waitForAsync(page, async () => {
    const data = await window.hibi.readAddonStorage({
      owner: 'autocomplete',
      scope: { kind: 'global' },
      key: 'learned-words',
      version: 1,
    })
    return (
      data.status === 'ready' &&
      data.value.entries.some((row) => row.word === 'freshword')
    )
  })
  await clickMenu(app, 'Command palette')
  await page
    .getByRole('combobox', { name: /search commands/i })
    .fill('Autocomplete: clear learned words')
  await page
    .getByRole('option', { name: /Autocomplete: clear learned words/i })
    .click()
  await page
    .getByRole('dialog', { name: 'Clear learned words' })
    .getByRole('button', { name: 'Everything', exact: true })
    .click()
  await confirmation
    .getByRole('button', { name: 'Clear learned words', exact: true })
    .click()
  await waitForAsync(page, async () => {
    const data = await window.hibi.readAddonStorage({
      owner: 'autocomplete',
      scope: { kind: 'global' },
      key: 'learned-words',
      version: 1,
    })
    return data.status === 'ready' && data.value.entries.length === 0
  })
  assert.deepEqual((await disk()).entries['learned-words'].value.entries, [])
  await confirmation.waitFor({ state: 'hidden' })
  const learnWord = async (word) => {
    await rich.evaluate((element) => element.editor.commands.focus('end'))
    await page.keyboard.type(` ${word} `)
    await waitForAsync(
      page,
      async (word) => {
        const data = await window.hibi.readAddonStorage({
          owner: 'autocomplete',
          scope: { kind: 'global' },
          key: 'learned-words',
          version: 1,
        })
        return (
          data.status === 'ready' &&
          data.value.entries.some((row) => row.word === word)
        )
      },
      word,
    )
  }
  await learnWord('outsideword')
  const workspace = join(profile, 'workspace-fixture')
  await mkdir(workspace)
  await writeFile(join(workspace, 'note.md'), 'existing ')
  await app.evaluate(({ dialog }, workspace) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [workspace],
    })
    dialog.showMessageBox = async () => ({ response: 1 })
  }, workspace)
  await page.getByRole('button', { name: /toggle workspace sidebar/i }).click()
  await page
    .getByRole('button', { name: /^open workspace$/i, exact: true })
    .click()
  await page.getByRole('treeitem', { name: /^note\.md$/i, exact: true }).click()
  await waitForAsync(page, async () => {
    const document = await window.hibi.getDocument()
    const workspace = await window.hibi.getWorkspace()
    return document.name === 'note.md' && workspace?.activePath === 'note.md'
  })
  await waitForDocumentEditor(app, page)
  await learnWord('workspaceword')
  const workspaceId = await page.evaluate(
    async () => (await window.hibi.getWorkspace()).id,
  )
  const scoped = (await stored()).value.entries
  assert.ok(
    scoped.some((row) => row.word === 'outsideword' && row.scope === null),
  )
  assert.ok(
    scoped.some(
      (row) => row.word === 'workspaceword' && row.scope === workspaceId,
    ),
  )
  await settings()
  await page.locator('#autocomplete-clear-scope').selectOption('workspace')
  await clearButton.click()
  await confirmation
    .getByRole('button', { name: 'Clear learned words', exact: true })
    .click()
  await confirmation.waitFor({ state: 'hidden' })
  const remaining = (await disk()).entries['learned-words'].value.entries
  assert.ok(remaining.some((row) => row.word === 'outsideword'))
  assert.ok(remaining.every((row) => row.scope !== workspaceId))
  assert.deepEqual(await app.evaluate(() => globalThis.autocompleteNetwork), [])
  assert.deepEqual(errors, [])
})

test('legacy dictionary suggestions enable autocomplete at startup while explicit off stays off', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-autocomplete-migration-'))
  await writeFile(
    join(profile, 'addons.json'),
    JSON.stringify({ dictionary: true }),
  )
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  await waitForDocumentEditor(app, page)
  const seedLegacy = () =>
    page.evaluate(() => {
      localStorage.removeItem('hibi:autocomplete')
      localStorage.setItem(
        'hibi:dictionary:typing',
        JSON.stringify({
          suggest: true,
          languages: ['fr', 'en'],
          tabAccepts: false,
        }),
      )
    })
  await seedLegacy()
  await page.reload()
  await waitForDocumentEditor(app, page)
  await waitForAsync(page, async () => {
    const states = await window.hibi.getAddonStates()
    return (
      states.some((state) => state.id === 'autocomplete' && state.enabled) &&
      localStorage.getItem('hibi:dictionary:typing') === null
    )
  })
  const migrated = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('hibi:autocomplete')),
  )
  assert.equal(migrated.suggest, true)
  assert.equal(migrated.tabAccepts, false)
  assert.deepEqual(migrated.languages, ['fr', 'en'])
  assert.equal(
    JSON.parse(await readFile(join(profile, 'addons.json'), 'utf8'))
      .autocomplete,
    true,
  )

  await page.evaluate(() => window.hibi.setAddonEnabled('autocomplete', false))
  await seedLegacy()
  await page.reload()
  await waitForDocumentEditor(app, page)
  await waitForAsync(
    page,
    () => localStorage.getItem('hibi:dictionary:typing') === null,
  )
  const states = await page.evaluate(() => window.hibi.getAddonStates())
  assert.equal(
    states.find((state) => state.id === 'autocomplete').enabled,
    false,
  )
  assert.equal(
    JSON.parse(await readFile(join(profile, 'addons.json'), 'utf8'))
      .autocomplete,
    false,
  )
})
