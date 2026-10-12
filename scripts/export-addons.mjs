import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function exportAddons(source, destination) {
  const files = []
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await collect(path)
      else if (
        entry.isFile() &&
        (path === join(source, 'authors.ts') ||
          basename(path) === 'manifest.ts' ||
          basename(path) === 'hibi-addon.json' ||
          /\.(md|png|jpe?g|gif|webp|avif|svg|ico)$/i.test(path))
      )
        files.push(relative(source, path))
    }
  }
  // Collect regular data files first. Never follow links or execute addon code.
  await collect(source)
  if (
    !files.includes('authors.ts') ||
    !files.some((file) => basename(file) === 'manifest.ts')
  )
    throw new Error(
      'addon source needs authors.ts and at least one manifest.ts',
    )
  await rm(destination, { recursive: true, force: true })
  for (const file of files) {
    const target = join(destination, file)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(source, file), target)
  }
  return files.sort()
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const files = await exportAddons(
    join(root, 'src/addons'),
    join(root, 'out/addons'),
  )
  console.log(`Exported ${files.length} addon data files to out/addons`)
}
