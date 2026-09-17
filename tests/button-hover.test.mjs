import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { bundledColorschemes } from '../src/shared/color-palettes.ts'
import { electron } from './electron.mjs'

test('primary, selected, and disabled buttons retain their color pairs while hovered in every palette', async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-hover-'))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => {
    const panel = document.createElement('div')
    panel.style.cssText =
      'position:fixed;left:100px;top:100px;z-index:99999;display:flex;gap:12px'
    for (const kind of [
      'primary',
      'legacy',
      'row',
      'ghost',
      'default',
      'disabled',
    ]) {
      const button = document.createElement('button')
      button.textContent = kind
      button.id = `hover-${kind}`
      button.className = `ui-button ${kind === 'legacy' ? 'dialog-primary' : ''}`
      button.dataset.variant = kind === 'disabled' ? 'primary' : kind
      if (['row', 'ghost'].includes(kind))
        button.setAttribute('aria-pressed', 'true')
      if (kind === 'disabled') button.disabled = true
      panel.append(button)
    }
    document.body.append(panel)
  })
  for (const scheme of bundledColorschemes) {
    await page.evaluate((colors) => {
      for (const [key, value] of Object.entries(colors))
        document.documentElement.style.setProperty(`--${key}`, value)
    }, scheme.colors)
    for (const kind of ['primary', 'legacy', 'row', 'ghost', 'disabled']) {
      const button = page.locator(`#hover-${kind}`)
      await page.mouse.move(0, 0)
      const colors = () =>
        button.evaluate((element) => {
          const style = getComputedStyle(element)
          return { background: style.backgroundColor, foreground: style.color }
        })
      const before = await colors()
      await button.hover({ force: true })
      assert.deepEqual(await colors(), before, `${scheme.id}: ${kind}`)
    }
  }
})
