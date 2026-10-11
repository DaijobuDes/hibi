import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, Menu, Tray } from 'electron'
import { getUiCase } from './ui-case'

export class BackgroundMode {
  private value = false
  private tray: Tray | null = null
  private writing: Promise<unknown> = Promise.resolve()
  private readonly path = join(app.getPath('userData'), 'background.json')

  constructor(
    private readonly actions: {
      open: () => void
      settings: () => void
      quickNote: () => void
      hasQuickNote: () => boolean
    },
  ) {}

  get enabled() {
    return this.value && this.tray !== null && !this.tray.isDestroyed()
  }

  async load() {
    try {
      this.value = JSON.parse(await readFile(this.path, 'utf8')) === true
    } catch {
      this.value = false
    }
    this.refresh()
  }

  save(input: unknown): Promise<boolean> {
    if (typeof input !== 'boolean')
      throw new Error('Choose whether to keep Hibi running in the background.')
    const writing = this.writing
      .catch(() => {})
      .then(async () => {
        await writeFile(`${this.path}.tmp`, JSON.stringify(input), {
          mode: 0o600,
        })
        await rename(`${this.path}.tmp`, this.path)
        this.value = input
        this.refresh()
        return this.enabled
      })
    this.writing = writing
    return writing
  }

  refresh() {
    if (!this.value) {
      this.dispose()
      return
    }
    if (!this.tray) {
      const name =
        process.platform === 'darwin'
          ? 'trayTemplate.png'
          : process.platform === 'win32'
            ? 'tray.ico'
            : 'tray.png'
      this.tray = new Tray(
        app.isPackaged
          ? join(process.resourcesPath, 'icons', name)
          : join(app.getAppPath(), 'build', name),
      )
      this.tray.setToolTip('Hibi')
      if (process.platform === 'win32') this.tray.on('click', this.actions.open)
    }
    const menu = Menu.buildFromTemplate([
      { label: 'Open Hibi', click: this.actions.open },
      ...(this.actions.hasQuickNote()
        ? [{ label: 'New quick note', click: this.actions.quickNote }]
        : []),
      { label: 'Settings', click: this.actions.settings },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])
    if (getUiCase() === 'lowercase')
      for (const item of menu.items) item.label = item.label.toLocaleLowerCase()
    // Linux needs the context menu assigned again after command availability changes.
    this.tray.setContextMenu(menu)
  }

  dispose() {
    this.tray?.destroy()
    this.tray = null
  }
}
