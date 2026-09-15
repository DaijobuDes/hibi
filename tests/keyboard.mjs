// CDP keyboard events bypass Electron's native shortcut processing.
export async function pressShortcut(app, shortcut) {
  const parts = shortcut.split('+')
  const keyCode = parts.pop().toUpperCase()
  const modifiers = parts.map(
    (part) =>
      ({ Meta: 'meta', Control: 'control', Shift: 'shift', Alt: 'alt' })[part],
  )
  await app.evaluate(
    ({ BrowserWindow }, input) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.sendInputEvent({ type: 'keyDown', ...input })
      contents.sendInputEvent({ type: 'keyUp', ...input })
    },
    { keyCode, modifiers },
  )
}
