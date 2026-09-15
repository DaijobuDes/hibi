import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { _electron as electron } from 'playwright'
import { imageSources, readDocumentImage } from '../src/main/images.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64',
)

test('local images resolve from the note, validate content, and retain their Markdown paths', {
  timeout: 30000,
}, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'hibi-images-'))
  const assets = join(folder, 'assets')
  await mkdir(assets)
  const image = join(assets, 'my image.png')
  await writeFile(image, png)
  await writeFile(join(assets, 'fake.png'), 'private text is not image data')
  const first = join(folder, 'first.md')
  const original = `![relative](assets/my%20image.png)\n\n![absolute](<${image}>)\n\n![file](${pathToFileURL(image).href})\n\nbody`
  await writeFile(first, original)
  assert.equal(imageSources(original).size, 3)
  for (const source of imageSources(original)) {
    assert.equal(
      await readDocumentImage(source, first),
      `data:image/png;base64,${png.toString('base64')}`,
    )
  }
  assert.equal(await readDocumentImage('assets/my%20image.png', null), null)
  assert.equal(await readDocumentImage('assets/fake.png', first), null)
  assert.equal(
    await readDocumentImage('https://example.com/image.png', first),
    null,
  )
  assert.equal(await readDocumentImage('missing.png', first), null)
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${join(folder, 'profile')}`],
  })
  t.after(async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 })
    })
    await app.close()
    await rm(folder, { recursive: true, force: true })
  })
  await app.evaluate(({ dialog }, first) => {
    dialog.showOpenDialog = async () => {
      await new Promise((resolve) => setTimeout(resolve, 180))
      return { canceled: false, filePaths: [first] }
    }
  }, first)
  const page = await app.firstWindow()
  await page.getByRole('textbox', { name: 'document editor' }).waitFor()
  const toolbar = await page.evaluate(async () => {
    const header = document.querySelector('.titlebar')
    const button = header.querySelector('button[aria-label="open"]')
    button.click()
    const frames = []
    const start = performance.now()
    while (performance.now() - start < 450) {
      await new Promise(requestAnimationFrame)
      frames.push({
        same: header === document.querySelector('.titlebar'),
        opacity: getComputedStyle(button).opacity,
        busy: header.getAttribute('aria-busy'),
      })
    }
    return frames
  })
  assert.ok(toolbar.some((frame) => frame.busy === 'true'))
  assert.ok(
    toolbar.every((frame) => frame.same && frame.opacity === '1'),
    JSON.stringify(toolbar),
  )
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.tiptap img')].length === 3 &&
      [...document.querySelectorAll('.tiptap img')].every(
        (image) => image.complete && image.naturalWidth === 1,
      ),
  )
  const revision = (await page.evaluate(() => window.hibi.getDocument()))
    .revision
  assert.equal(
    await page.evaluate(
      (revision) => window.hibi.readDocumentImage('/etc/passwd', revision),
      revision,
    ),
    null,
  )
  assert.equal(
    await page.evaluate(
      (revision) =>
        window.hibi.readDocumentImage('assets/my%20image.png', revision - 1),
      revision,
    ),
    null,
  )
  await page.locator('.tiptap p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' edited')
  const markdown = (await page.evaluate(() => window.hibi.getDocument()))
    .markdown
  assert.ok(markdown.includes('assets/my%20image.png'))
  assert.ok(markdown.includes(image))
  assert.ok(!markdown.includes('data:image'))
})
