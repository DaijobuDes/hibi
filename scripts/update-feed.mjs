import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { classifyRelease } from './nightly.mjs'

export async function updateFeed(release, directory) {
  const classified = classifyRelease(
    { ...release, tag: release.tag.replace(/^nightly-broken-/, 'nightly-') },
    release.reports,
  )
  if (classified.status !== release.status || classified.tag !== release.tag)
    throw new Error('Update metadata must match the classified release')
  const names = await readdir(directory)
  const assets = {}
  for (const [platform, suffix] of [
    ['win32-x64', '-win-x64.exe'],
    ['linux-x64', '.AppImage'],
    ['darwin-arm64', '-mac-arm64.dmg'],
    ['darwin-x64', '-mac-x64.dmg'],
  ]) {
    const matches = names.filter(
      (name) =>
        name.startsWith(`hibi-${release.version}-`) && name.endsWith(suffix),
    )
    if (matches.length !== 1)
      throw new Error(`Missing or ambiguous updater package: ${platform}`)
    const name = matches[0]
    const hash = createHash('sha512')
    let size = 0
    for await (const chunk of createReadStream(resolve(directory, name))) {
      hash.update(chunk)
      size += chunk.length
    }
    assets[platform] = { name, sha512: hash.digest('base64'), size }
  }
  const manifest = {
    tag: release.tag,
    version: release.version,
    status: release.status,
    assets,
  }
  await writeFile(
    resolve(directory, 'update.json'),
    JSON.stringify(manifest, null, 2),
  )
  // JSON is valid YAML. Each feed is pinned to this immutable release's packages.
  for (const [platform, name] of [
    ['win32-x64', 'latest.yml'],
    ['linux-x64', 'latest-linux.yml'],
  ]) {
    const asset = assets[platform]
    await writeFile(
      resolve(directory, name),
      JSON.stringify(
        {
          version: release.version,
          files: [{ url: asset.name, sha512: asset.sha512, size: asset.size }],
          path: asset.name,
          sha512: asset.sha512,
        },
        null,
        2,
      ),
    )
  }
  return manifest
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await updateFeed(
    JSON.parse(await readFile('release.json', 'utf8')),
    'installers',
  )
