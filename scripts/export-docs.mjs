import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  imageSources,
  readDocumentImage,
  resolveDocumentMediaPath,
} from '../src/main/images.ts'

const root = await realpath(resolve(process.argv[2] ?? 'docs'))
const output = resolve(process.argv[3] ?? 'out/docs/index.html')
const files = (await readdir(root, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
  .map((entry) => join(entry.parentPath, entry.name))
  .sort()
if (!files.length) throw new Error('No Markdown documents to export.')

const pages = []
for (const file of files) {
  const markdown = await readFile(file, 'utf8')
  const images = Object.create(null)
  for (const source of imageSources(markdown)) {
    const candidate = await resolveDocumentMediaPath(source, file, root)
    if (!candidate) continue
    const path = await realpath(candidate)
    const part = relative(root, path)
    if (part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part))
      throw new Error(
        `Documentation image is outside the docs folder: ${source}`,
      )
    const image = await readDocumentImage(path, null)
    if (image) images[source] = image
  }
  pages.push({
    path: relative(root, file).split(sep).join('/'),
    markdown,
    images,
  })
}
const template = await readFile('out/site/template.html', 'utf8')
const data = JSON.stringify({ name: 'hibi documentation', pages })
  .replaceAll('<', '\\u003c')
  .replaceAll('\u2028', '\\u2028')
  .replaceAll('\u2029', '\\u2029')
await mkdir(dirname(output), { recursive: true })
await writeFile(
  output,
  template.replace('__HIBI_WORKSPACE_DATA__', () => data),
)
console.log(`Exported ${pages.length} documentation pages to ${output}`)
