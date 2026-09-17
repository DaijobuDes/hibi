import { resolve } from 'node:path'
import { electron } from '../tests/electron.mjs'
import { clickMenu, pressShortcut } from '../tests/keyboard.mjs'

export const benchmarkDocuments = [
  {
    name: 'large.md',
    title: 'Large benchmark',
    source:
      '# Large benchmark\n\n' +
      'A paragraph for measuring document layout and keyboard input. **Bold** and _italic_.\n\n'.repeat(
        180,
      ),
  },
  {
    name: 'code.md',
    title: 'Code benchmark',
    source:
      '# Code benchmark\n\n' +
      [
        '```js\nconst answer = 42;\n```',
        '```rust\nfn main() { let answer = 42; }\n```',
        '```python\ndef answer():\n  return 42\n```',
        '```sql\nSELECT name FROM notes;\n```',
      ]
        .join('\n\n')
        .concat('\n\n')
        .repeat(20),
  },
]

export async function launchBenchmarkApp(profile, entry = resolve('.')) {
  const app = await electron.launch({
    args: [entry, `--user-data-dir=${profile}`],
  })
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    return app
  } catch (error) {
    await app.close()
    throw error
  }
}

// Frame polling avoids locator retry backoff being counted as startup latency.
export function waitForEditor(page) {
  return page.waitForFunction(() => {
    const editor = document.querySelector(
      '[role="textbox"][aria-label="Document editor"]',
    )
    return (
      editor?.isContentEditable &&
      !editor.closest('[inert]') &&
      editor.getBoundingClientRect().width > 0
    )
  })
}

export function waitForWorkspaces(page, paths) {
  return page.waitForFunction((paths) => {
    const buttons = [
      ...document.querySelectorAll('.startup-placeholder li button'),
    ]
    return (
      buttons.length === paths.length &&
      buttons.every(
        (button, index) =>
          button.textContent === paths[index] &&
          !button.disabled &&
          !button.closest('[inert]'),
      )
    )
  }, paths)
}

export async function typeCharacter(page, previousText, character = 'x') {
  await page
    .getByRole('textbox', { name: 'Document editor', exact: true })
    .press(character)
  await page.waitForFunction(
    (previous) =>
      document.querySelector('[role="textbox"][aria-label="Document editor"]')
        ?.textContent !== previous,
    previousText,
  )
}

export function selectBenchmarkFile(app, file) {
  return app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
}

export async function openBenchmarkDocument(app, page, title) {
  await clickMenu(app, 'Open…')
  await page.waitForFunction(
    (title) =>
      [...document.querySelectorAll('.tiptap h1')].some(
        (heading) => heading.textContent === title,
      ),
    title,
  )
}

export async function switchToSource(app, page) {
  await pressShortcut(
    app,
    `${process.platform === 'darwin' ? 'Meta' : 'Control'}+Shift+]`,
  )
  await page.waitForFunction(() => {
    const pane = document.querySelector('.source-pane')
    const editor = pane?.querySelector('.cm-content')
    return (
      editor?.isContentEditable &&
      !editor.closest('[inert]') &&
      document.querySelector('.editor-panes')?.dataset.sourceReady === 'true' &&
      getComputedStyle(pane).visibility === 'visible' &&
      Number(getComputedStyle(pane).opacity) === 1 &&
      Number(getComputedStyle(pane.parentElement).opacity) === 1
    )
  })
}
