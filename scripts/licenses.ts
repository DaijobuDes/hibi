import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { LicenseInfo } from '../src/shared/about.ts'
import { themeLicenses } from '../src/shared/theme-licenses.ts'

type Package = {
  name: string
  version: string
  license?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

// All other direct dependencies are application code or assets. Electron's npm
// dependencies install its binary; they are not shipped in the application bundle.
const buildTools = new Set([
  '@biomejs/biome',
  '@codspeed/vitest-plugin',
  '@vitejs/plugin-react',
  'electron-builder',
  'electron-vite',
  'playwright',
  'typescript',
  'vite',
  'vitest',
])

export async function collectLicenses(root = resolve('.')) {
  const manifest: Package = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  )
  const entries = new Map<string, LicenseInfo & { text: string }>()
  async function visit(name: string, from = root): Promise<void> {
    if (name.startsWith('@types/')) return
    let folder: string, pkg: Package
    for (;;) {
      folder = join(from, 'node_modules', name)
      try {
        pkg = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'))
        break
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
          dirname(from) === from
        )
          throw error
        from = dirname(from)
      }
    }
    const id = `${pkg.name}@${pkg.version}`
    if (entries.has(id)) return
    const files = await readdir(folder)
    const notices = files
      .filter((file) => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(file))
      .sort()
    let text = (
      await Promise.all(
        notices.map(
          async (file) =>
            `${file}\n\n${await readFile(join(folder, file), 'utf8')}`,
        ),
      )
    ).join('\n\n')
    if (!text) {
      const readme = files.find((file) =>
        /^readme(?:\.md|\.markdown|\.txt)?$/i.test(file),
      )
      const source = readme ? await readFile(join(folder, readme), 'utf8') : ''
      const section =
        /^#{1,6}\s+licen[sc]e[^\n]*\n([\s\S]*?)(?=^#{1,6}\s|$(?![\s\S]))/im
          .exec(source)?.[1]
          ?.trim()
      if (!section || section.length < 300 || !/copyright/i.test(section))
        throw new Error(`missing license notice: ${id}`)
      text = `${readme} — license section\n\n${section}`
    }
    entries.set(id, {
      id,
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? 'see notice',
      text,
    })
    if (name !== 'electron')
      for (const dependency of Object.keys(pkg.dependencies ?? {}))
        await visit(dependency, folder)
  }
  for (const name of Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  }))
    if (!buildTools.has(name)) await visit(name)
  for (const [name, license] of Object.entries(themeLicenses))
    entries.set(`palette:${name}`, {
      id: `palette:${name}`,
      name: `${name} colorscheme`,
      license: license.name,
      text: `${license.text}\nsource: ${license.source}`,
    })
  return [...entries.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      (a.version ?? '').localeCompare(b.version ?? ''),
  )
}

export async function writeLicenses() {
  await mkdir('out', { recursive: true })
  await writeFile('out/licenses.json', JSON.stringify(await collectLicenses()))
}
