import assert from 'node:assert/strict'

export async function checkSidebarResize(
  page,
  defaultWidth,
  contentSelector,
  reload,
) {
  const handle = page.getByRole('separator', {
    name: /^resize sidebar$/i,
    exact: true,
  })
  await handle.waitFor()
  const bounds = await handle.boundingBox()
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + 120
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 88, y, { steps: 6 })
  const geometry = await page.evaluate((contentSelector) => {
    const sidebar = document.querySelector(
      '.sidebar-resizer[data-dragging="true"]',
    ).parentElement
    return {
      width: sidebar.offsetWidth,
      contentX: document.querySelector(contentSelector).getBoundingClientRect()
        .x,
    }
  }, contentSelector)
  assert.equal(geometry.width, defaultWidth + 88)
  assert.equal(geometry.contentX, geometry.width)
  await page.mouse.up()
  await handle.focus()
  await handle.press('ArrowLeft')
  assert.equal(
    Number(await handle.getAttribute('aria-valuenow')),
    defaultWidth + 80,
  )
  await handle.press('Home')
  assert.equal(Number(await handle.getAttribute('aria-valuenow')), 152)
  await handle.press('End')
  const maximum = Number(await handle.getAttribute('aria-valuemax'))
  assert.equal(Number(await handle.getAttribute('aria-valuenow')), maximum)
  const end = await handle.boundingBox()
  await page.mouse.move(end.x + 3, y)
  await page.mouse.down()
  await page.mouse.move(end.x - 32, y, { steps: 3 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  assert.equal(Number(await handle.getAttribute('aria-valuenow')), maximum)
  await page.waitForFunction(
    (width) => localStorage.getItem('sidebar-width') === String(width),
    maximum,
  )
  await reload()
  await handle.waitFor()
  assert.equal(Number(await handle.getAttribute('aria-valuenow')), maximum)
  const settled = async () =>
    page.waitForFunction(
      (element) =>
        Math.abs(
          element.getBoundingClientRect().x +
            3 -
            Number(element.getAttribute('aria-valuenow')),
        ) < 1,
      await handle.elementHandle(),
      { timeout: 5000 },
    )
  await settled()
  await handle.dblclick({ position: { x: 3, y: 120 } })
  assert.equal(Number(await handle.getAttribute('aria-valuenow')), defaultWidth)
  await settled()
  const reset = await handle.boundingBox()
  await page.mouse.move(reset.x + 3, y)
  await page.mouse.down()
  await page.mouse.move(reset.x + 3 + 120 - defaultWidth, y, { steps: 6 })
  assert.equal(Number(await handle.getAttribute('aria-valuenow')), 152)
  assert.equal(await handle.isVisible(), true)
  await page.mouse.move(reset.x + 3 + 100 - defaultWidth, y, { steps: 3 })
  await page.mouse.up()
  await handle.waitFor({ state: 'hidden' })
  await page
    .getByRole('button', { name: /toggle (workspace sidebar|navigation)/i })
    .click()
  await handle.waitFor()
  assert.equal(Number(await handle.getAttribute('aria-valuenow')), defaultWidth)
}
