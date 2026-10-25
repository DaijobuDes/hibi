import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { classifyRelease, releaseChannels } from './nightly.mjs'

export async function updateFeed(release, directory) {
  classifyRelease(release, release.reports)
  // Older updaters reject underscores in any platform's filename. Debian and
  // Flatpak packages use the same architecture labels as AppImages.
  const prefix = `hibi-${release.version}-linux-`
  const renames = (await readdir(directory)).map((source) => {
    const alias =
      source.startsWith(prefix) &&
      /^(x86_64|amd64|aarch64)(\.(?:AppImage|deb|flatpak))$/.exec(
        source.slice(prefix.length),
      )
    return [
      source,
      alias
        ? `${prefix}${alias[1] === 'aarch64' ? 'arm64' : 'x64'}${alias[2]}`
        : source,
    ]
  })
  const names = renames.map(([, name]) => name)
  if (new Set(names).size !== names.length)
    throw new Error('Ambiguous Linux packages')
  for (const [source, name] of renames)
    if (source !== name)
      await rename(resolve(directory, source), resolve(directory, name))
  const assets = {}
  const hashAsset = async (name) => {
    const hash = createHash('sha512')
    let size = 0
    for await (const chunk of createReadStream(resolve(directory, name))) {
      hash.update(chunk)
      size += chunk.length
    }
    return { name, sha512: hash.digest('base64'), size }
  }
  for (const [platform, suffix] of [
    ['win32-x64', '-win-x64.exe'],
    ['linux-x64', '-linux-x64.AppImage'],
    ['linux-arm64', '-linux-arm64.AppImage'],
    ['darwin-arm64', '-mac-arm64.dmg'],
    ['darwin-x64', '-mac-x64.dmg'],
  ]) {
    // Debian and Flatpak packages are replaced manually, never through this feed.
    const matches = names.filter(
      (name) =>
        name.startsWith(`hibi-${release.version}-`) && name.endsWith(suffix),
    )
    if (matches.length !== 1)
      throw new Error(`Missing or ambiguous updater package: ${platform}`)
    assets[platform] = await hashAsset(matches[0])
    if (platform.startsWith('darwin-')) {
      const zipName = `hibi-${release.version}-mac-${platform.slice(7)}.zip`
      if (!names.includes(zipName))
        throw new Error(`Missing updater ZIP: ${platform}`)
      assets[platform].zip = await hashAsset(zipName)
    }
  }
  const manifest = {
    tag: release.tag,
    version: release.version,
    assets,
  }
  await writeFile(
    resolve(directory, 'feed.json'),
    JSON.stringify(manifest, null, 2),
  )
  // JSON is valid YAML. Each feed is pinned to this immutable release's packages.
  for (const [platform, name] of [
    ['win32-x64', 'latest.yml'],
    ['linux-x64', 'latest-linux.yml'],
    ['linux-arm64', 'latest-linux-arm64.yml'],
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
  const macFiles = [assets['darwin-x64'].zip, assets['darwin-arm64'].zip].map(
    (asset) => ({ url: asset.name, sha512: asset.sha512, size: asset.size }),
  )
  await writeFile(
    resolve(directory, 'latest-mac.yml'),
    JSON.stringify(
      {
        version: release.version,
        files: macFiles,
        path: macFiles[0].url,
        sha512: macFiles[0].sha512,
      },
      null,
      2,
    ),
  )
  return manifest
}

export async function promoteFeeds(
  release,
  directory,
  repository,
  gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }),
  isAncestor = (previous, sha) => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', previous, sha], {
        stdio: 'ignore',
      })
      return true
    } catch {
      return false
    }
  },
) {
  classifyRelease(release, release.reports)
  const feed = JSON.parse(
    await readFile(resolve(directory, 'feed.json'), 'utf8'),
  )
  if (feed.tag !== release.tag || feed.version !== release.version)
    throw new Error('Channel feed must pin the published release')
  for (const channel of releaseChannels(release)) {
    const endpoint = `repos/${repository}/git/refs/tags/${channel}`
    let previous
    try {
      previous = JSON.parse(
        gh('api', `repos/${repository}/git/ref/tags/${channel}`),
      ).object.sha
    } catch {
      // The first publication creates the rolling tag.
    }
    if (channel === 'beta' && previous && !isAncestor(previous, release.sha)) {
      console.log('::notice::Preserving the newer beta feed.')
      continue
    }
    if (previous)
      gh(
        'api',
        '--method',
        'PATCH',
        endpoint,
        '-f',
        `sha=${release.sha}`,
        '-F',
        'force=true',
      )
    else
      gh(
        'api',
        '--method',
        'POST',
        `repos/${repository}/git/refs`,
        '-f',
        `ref=refs/tags/${channel}`,
        '-f',
        `sha=${release.sha}`,
      )
    const title =
      channel === 'beta' ? 'Beta (stable)' : 'Nightly (bleeding edge)'
    const notes =
      channel === 'beta'
        ? 'This channel follows betas that passed all checks on every platform. Downloads are pinned to the versioned release.'
        : 'This channel follows the latest published build. Nightlies are bleeding edge. Back up your notes before installing.'
    const run = (...args) => gh('release', ...args, '--repo', repository)
    let exists = false
    try {
      run('view', channel)
      exists = true
    } catch {
      // Create the rolling prerelease without making it GitHub's latest release.
    }
    if (!exists)
      run(
        'create',
        channel,
        '--target',
        release.sha,
        '--title',
        title,
        '--notes',
        notes,
        '--prerelease',
        '--latest=false',
      )
    run('upload', channel, resolve(directory, 'feed.json'), '--clobber')
    run(
      'edit',
      channel,
      '--target',
      release.sha,
      '--title',
      title,
      '--notes',
      notes,
      '--prerelease',
      '--latest=false',
    )
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const release = JSON.parse(await readFile('release.json', 'utf8'))
  if (process.argv[2] === 'publish')
    await promoteFeeds(release, 'installers', process.env.GITHUB_REPOSITORY)
  else await updateFeed(release, 'installers')
}
