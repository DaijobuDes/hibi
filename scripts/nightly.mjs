import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function nightly(cwd = '.', date = new Date()) {
  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  const sha = git('rev-parse', 'HEAD')
  const tags = git('tag', '--merged', 'HEAD').split('\n').filter(Boolean)
  const previous = tags.length
    ? git(
        'describe',
        '--tags',
        '--match',
        tags.some((tag) => tag.startsWith('nightly-')) ? 'nightly-*' : '*',
        '--abbrev=0',
        'HEAD',
      )
    : undefined
  const day = date.toISOString().slice(0, 10)
  const base = JSON.parse(
    readFileSync(resolve(cwd, 'package.json'), 'utf8'),
  ).version.split('-')[0]
  return {
    sha,
    previous,
    changed: !previous || git('rev-list', '-1', previous) !== sha,
    tag: `nightly-${day}-${sha.slice(0, 7)}`,
    version: `${base}-nightly.${day.replaceAll('-', '')}.${sha.slice(0, 7)}`,
    commits: git(
      'log',
      '--format=%H%x09%s',
      previous ? `${previous}..HEAD` : 'HEAD',
    ),
  }
}

export function releaseNotes(release, repository, checksums) {
  const url = `https://github.com/${repository}`
  const assets = checksums
    .trim()
    .split('\n')
    .map((line) => {
      const match = /^([a-f0-9]{64}) [ *](.+)$/.exec(line)
      if (!match) throw new Error('Invalid nightly checksum entry')
      const name = match[2].replace(/^\.\//, '')
      return {
        name,
        hash: match[1],
        url: `${url}/releases/download/${encodeURIComponent(release.tag)}/${encodeURIComponent(name)}`,
      }
    })
  const download = (label, suffix) => {
    const asset = assets.find(({ name }) => name.endsWith(suffix))
    if (!asset) throw new Error(`Missing nightly download: ${label}`)
    return `[${label}](${asset.url})`
  }
  const commits = release.commits
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, ...subject] = line.split('\t')
      const title = subject.join('\t').replace(/[\\`*_{}[\]<>]/g, '\\$&')
      return `- ${title} ([${sha.slice(0, 7)}](${url}/commit/${sha}))`
    })
  return [
    `this nightly was built from sha \`${release.sha.slice(0, 7)}\`.`,
    '',
    '**:warning: always back up before using a nightly!**',
    '',
    [
      download('windows', '-win-x64.exe'),
      download('macOS (intel)', '-mac-x64.dmg'),
      download('linux (appImage)', '.AppImage'),
    ].join(' • '),
    '',
    '---',
    '',
    ...assets.flatMap((asset) => [
      `SHA256 ([${asset.name}](${asset.url})): \`${asset.hash}\``,
      '',
    ]),
    '## changes',
    '',
    ...commits,
    '',
    ...(release.previous
      ? [
          `[full comparison](${url}/compare/${encodeURIComponent(release.previous)}...${release.sha})`,
          '',
        ]
      : []),
  ].join('\n')
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const release = nightly()
  if (process.argv[2] === 'prepare') {
    const values = ['sha', 'changed', 'tag', 'version']
      .map((key) => `${key}=${release[key]}`)
      .join('\n')
    appendFileSync(process.env.GITHUB_OUTPUT, `${values}\n`)
  } else if (process.argv[2] === 'notes') {
    release.version = process.argv[3] ?? release.version
    release.tag = process.env.TAG ?? release.tag
    const checksums = readFileSync(
      resolve(process.argv[4] ?? 'installers/SHA256SUMS.txt'),
      'utf8',
    )
    process.stdout.write(
      releaseNotes(release, process.env.GITHUB_REPOSITORY, checksums),
    )
  } else {
    throw new Error('Usage: node scripts/nightly.mjs prepare|notes')
  }
}
