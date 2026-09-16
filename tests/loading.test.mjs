import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron } from './electron.mjs'

test('loading page is centered, animates, and respects reduced motion', {
  timeout: 30000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-loading-'))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  const page = await app.firstWindow()
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  const state = await page.evaluate(() => window.hibi.getDocument())
  await app.evaluate(({ ipcMain }, state) => {
    globalThis.releaseLoading = []
    ipcMain.removeHandler('document:get')
    ipcMain.handle(
      'document:get',
      () =>
        new Promise((resolve) =>
          globalThis.releaseLoading.push(() => resolve(state)),
        ),
    )
  }, state)
  await page.reload()
  await page.getByRole('status', { name: 'loading editor' }).waitFor()
  const loading = await page.evaluate(() => {
    const icon = document.querySelector('.loading-page').getBoundingClientRect()
    return {
      centered:
        Math.abs(icon.x + icon.width / 2 - innerWidth / 2) < 0.5 &&
        Math.abs(icon.y + icon.height / 2 - innerHeight / 2) < 0.5,
      animation: getComputedStyle(document.querySelector('.loading-page-shine'))
        .animationName,
      faded:
        Number(
          getComputedStyle(document.querySelector('.loading-page-base'))
            .opacity,
        ) < 0.3,
    }
  })
  assert.deepEqual(loading, {
    centered: true,
    animation: 'page-shine',
    faded: true,
  })
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/loading.png' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(
    await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('.loading-page-shine'))
          .animationName,
    ),
    'none',
  )
  await app.evaluate(() =>
    globalThis.releaseLoading.forEach((release) => {
      release()
    }),
  )
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  assert.equal(
    await page.getByRole('status', { name: 'loading editor' }).count(),
    0,
  )
})
