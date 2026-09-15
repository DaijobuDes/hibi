import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { _electron as electron } from 'playwright'

test('documentation breadcrumbs, outline, pagination, and phone navigation', {
  timeout: 45000,
}, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'hibi-site-'))
  const html = join(folder, 'docs.html')
  const paragraph = 'a short paragraph for this section.\n\n'.repeat(9)
  const snapshot = {
    name: 'hibi documentation',
    pages: [
      {
        path: 'README.md',
        markdown: '# welcome\n\na quiet place for your documentation.',
      },
      {
        path: 'guides/start.md',
        markdown: `# getting started\n\n## introduction\n\n${paragraph}## install\n\n\`\`\`sh\n${'long-command-'.repeat(30)}\n\`\`\`\n\n| option | value |\n| --- | --- |\n| long | ${'table-value-'.repeat(40)} |\n\n${paragraph}## usage\n\n### first step\n\n${paragraph}### next step\n\n${paragraph}`,
      },
      { path: 'guides/next.md', markdown: '# next steps\n\nkeep writing.' },
    ],
  }
  const template = await readFile('out/site/template.html', 'utf8')
  await writeFile(
    html,
    template.replace('__HIBI_WORKSPACE_DATA__', () =>
      JSON.stringify(snapshot).replaceAll('<', '\\u003c'),
    ),
  )
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${join(folder, 'profile')}`],
  })
  t.after(async () => {
    await app.close()
    await rm(folder, { recursive: true, force: true })
  })
  await app.firstWindow()
  const nextWindow = app.waitForEvent('window')
  await app.evaluate(({ BrowserWindow }, html) => {
    const window = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    void window.loadFile(html)
  }, html)
  const page = await nextWindow
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'welcome', exact: true }).waitFor()
  const pagination = page.getByRole('navigation', { name: 'page navigation' })
  await pagination.getByRole('link', { name: 'next getting started' }).click()
  await page
    .getByRole('heading', { name: 'getting started', exact: true })
    .waitFor()
  const breadcrumbs = page.getByRole('navigation', { name: 'breadcrumbs' })
  assert.ok(
    await breadcrumbs.evaluate((element) =>
      Boolean(element.closest('.site-header')),
    ),
  )
  assert.match(
    await breadcrumbs.innerText(),
    /hibi documentation.*guides.*getting started/s,
  )
  await page.waitForFunction(() => {
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect()
    const controls = document
      .querySelector('.site-navigation-controls')
      .getBoundingClientRect()
    const breadcrumbs = document
      .querySelector('.site-breadcrumbs')
      .getBoundingClientRect()
    return (
      Math.abs(controls.right - sidebar.right) < 1 &&
      breadcrumbs.left > sidebar.right
    )
  })
  assert.equal(await page.locator('.site-path').count(), 0)
  await page.locator('.site-outline').waitFor()
  const usage = page
    .locator('.site-outline')
    .getByRole('link', { name: 'usage', exact: true })
  await usage.click()
  await page.waitForFunction(() => location.hash.includes('anchor=usage'))
  const aligned = () => {
    const root = document.querySelector('.site-content').getBoundingClientRect()
    const heading = document.querySelector('#doc-usage').getBoundingClientRect()
    return heading.top >= root.top && heading.top < root.top + 60
  }
  await page.waitForFunction(aligned)
  await page.waitForFunction(
    () =>
      document.querySelector('.site-outline a[aria-current]')?.textContent ===
      'usage',
  )
  await page
    .locator('.site-content')
    .evaluate((element) => element.scrollTo(0, 0))
  await usage.click()
  await page.waitForFunction(aligned)
  assert.equal(
    await pagination.evaluate(
      (element) => getComputedStyle(element).borderTopWidth,
    ),
    '1px',
  )
  await pagination.getByRole('link', { name: 'next next steps' }).click()
  await page.getByRole('heading', { name: 'next steps', exact: true }).waitFor()
  await pagination
    .getByRole('link', { name: 'previous getting started' })
    .click()
  await page
    .getByRole('heading', { name: 'getting started', exact: true })
    .waitFor()
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/documentation-desktop.png' })
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    await page.locator('.site-outline-mobile').waitFor()
    await page.waitForFunction(
      () =>
        innerWidth > 700 ||
        document
          .querySelector('.documentation-site')
          .getAttribute('data-sidebar') === 'false',
    )
    const bounds = await page.evaluate(() => {
      const content = document.querySelector('.site-content')
      const header = document.querySelector('.site-header')
      return {
        width: innerWidth,
        page: document.documentElement.scrollWidth,
        content: content.clientWidth,
        scroll: content.scrollWidth,
        header: header.clientWidth,
        headerScroll: header.scrollWidth,
      }
    })
    assert.equal(bounds.page, width)
    assert.equal(bounds.scroll, bounds.content, JSON.stringify(bounds))
    assert.equal(bounds.headerScroll, bounds.header, JSON.stringify(bounds))
    const outline = page.locator('.site-outline-mobile')
    await outline.locator('summary').click()
    await outline.getByRole('link', { name: 'usage', exact: true }).click()
    assert.equal(await outline.evaluate((element) => element.open), false)
    await page.waitForFunction(aligned)
    if (width <= 700) {
      await page.getByRole('button', { name: 'toggle navigation' }).click()
      await page.waitForFunction(
        () => document.querySelector('.site-content').inert,
      )
      assert.equal(
        await page
          .getByRole('treeitem', { name: 'welcome', exact: true })
          .evaluate((element) => element.getBoundingClientRect().height),
        44,
      )
      await page.mouse.click(width - 12, 180)
      await page.waitForFunction(
        () =>
          document
            .querySelector('.documentation-site')
            .getAttribute('data-sidebar') === 'false',
      )
      await page.getByRole('button', { name: 'toggle navigation' }).click()
      await page.keyboard.press('Escape')
      await page.waitForFunction(
        () =>
          document
            .querySelector('.documentation-site')
            .getAttribute('data-sidebar') === 'false',
      )
      await page.getByRole('button', { name: 'toggle navigation' }).click()
      await page.getByRole('treeitem', { name: 'welcome', exact: true }).click()
      await page
        .getByRole('heading', { name: 'welcome', exact: true })
        .waitFor()
      assert.equal(
        await page.locator('.documentation-site').getAttribute('data-sidebar'),
        'false',
      )
      await pagination
        .getByRole('link', { name: 'next getting started' })
        .click()
      await page
        .getByRole('heading', { name: 'getting started', exact: true })
        .waitFor()
      if (width === 390)
        await page.screenshot({ path: 'test-results/documentation-mobile.png' })
    }
  }
  assert.deepEqual(errors, [])
})
