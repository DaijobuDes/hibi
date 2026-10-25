import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const platforms = [
  'linux-x64',
  'linux-arm64',
  'windows-x64',
  'macos-arm64',
  'macos-x64',
]

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

const compareVersions = (left, right) => {
  const a = left.split('.').map(BigInt)
  const b = right.split('.').map(BigInt)
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  return 0
}

export function nightly(
  cwd = '.',
  date = new Date(),
  bump = 'patch',
  run = '0.0',
) {
  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  if (!['patch', 'minor'].includes(bump))
    throw new Error('Choose a patch or minor version bump')
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(run))
    throw new Error('Invalid workflow run identity')
  const sha = git('rev-parse', 'HEAD')
  const version = JSON.parse(
    readFileSync(resolve(cwd, 'package.json'), 'utf8'),
  ).version
  if (!semver.test(version))
    throw new Error('package.json must have a plain semver version')
  const latest = git('tag', '--list', 'v*')
    .split('\n')
    .filter((tag) => semver.test(tag.slice(1)))
    .sort((a, b) => compareVersions(b.slice(1), a.slice(1)))[0]
  let betaVersion = version
  if (latest) {
    const [major, minor, patch] = latest.slice(1).split('.').map(BigInt)
    const next =
      bump === 'minor'
        ? `${major}.${minor + 1n}.0`
        : `${major}.${minor}.${patch + 1n}`
    if (compareVersions(next, betaVersion) > 0) betaVersion = next
  }
  const changed =
    !latest || git('rev-list', '--count', `${latest}..HEAD`) !== '0'
  const tags = git('tag', '--merged', 'HEAD')
    .split('\n')
    .filter(
      (tag) =>
        (semver.test(tag.slice(1)) && tag.startsWith('v')) ||
        /^nightly-(?:broken-)?\d{4}-\d{2}-\d{2}-[a-f0-9]{7}(?:-\d+-\d+)?$/.test(
          tag,
        ),
    )
  const previous = tags.length
    ? git(
        'describe',
        '--tags',
        ...tags.flatMap((tag) => ['--match', tag]),
        '--abbrev=0',
        'HEAD',
      )
    : undefined
  const day = date.toISOString().slice(0, 10)
  return {
    sha,
    previous,
    betaVersion,
    changed,
    nightlyTag: `nightly-${day}-${sha.slice(0, 7)}-${run.replace('.', '-')}`,
    nightlyVersion: `${betaVersion}-nightly.${day.replaceAll('-', '')}.g${sha.slice(0, 7)}.${run}`,
    commits: git(
      'log',
      '--format=%H%x09%s',
      previous ? `${previous}..HEAD` : 'HEAD',
    ),
  }
}

export function checksFromShards(platform, sha, reports) {
  if (
    !platforms.includes(platform) ||
    reports.length !== 4 ||
    [0, 1, 2, 3].some(
      (shard) =>
        reports.filter(
          (report) =>
            report.platform === platform &&
            report.sha === sha &&
            report.shard === shard,
        ).length !== 1,
    )
  )
    throw new Error(
      'Every release check shard must report the same platform and revision',
    )
  return reports.every((report) => report.checks === 'success')
    ? 'success'
    : 'failure'
}

export function decideRelease(release, shards) {
  if (shards.length !== platforms.length * 4)
    throw new Error('Every release check shard must report before deciding')
  const checks = platforms.map((platform) => ({
    platform,
    sha: release.sha,
    checks: checksFromShards(
      platform,
      release.sha,
      shards.filter((report) => report.platform === platform),
    ),
  }))
  const beta =
    release.changed && checks.every((report) => report.checks === 'success')
  return {
    ...release,
    channel: beta ? 'beta' : 'nightly',
    tag: beta ? `v${release.betaVersion}` : release.nightlyTag,
    version: beta ? release.betaVersion : release.nightlyVersion,
    checks,
    shards,
  }
}

export function classifyRelease(release, reports, shards = release.shards) {
  const decision = decideRelease(release, shards)
  if (
    ['channel', 'tag', 'version'].some((key) => release[key] !== decision[key])
  )
    throw new Error('Publication must match the checked release decision')
  if (
    reports.length !== platforms.length ||
    platforms.some(
      (platform) =>
        reports.filter((report) => report.platform === platform).length !== 1,
    )
  )
    throw new Error(
      'Every release platform must report its build, package and checks',
    )
  if (
    reports.some(
      (report) =>
        report.sha !== release.sha ||
        report.build !== 'success' ||
        report.package !== 'success',
    )
  )
    throw new Error('Cannot publish incomplete or mismatched packages')
  if (
    reports.some(
      (report) =>
        report.version !== release.version ||
        report.tag !== release.tag ||
        report.channel !== release.channel ||
        report.checks !==
          decision.checks.find(
            (checked) => checked.platform === report.platform,
          ).checks,
    )
  )
    throw new Error('Packaged release does not match the checked decision')
  return { ...decision, reports }
}

export function releaseChannels(release) {
  return release.channel === 'beta' ? ['beta', 'nightly'] : ['nightly']
}

function releaseAssets(release, repository, checksums) {
  const url = `https://github.com/${repository}`
  return checksums
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
}

export function nightlyWebhook(release, repository, checksums) {
  classifyRelease(release, release.reports)
  const beta = release.channel === 'beta'
  const role = '1550309423166267432'
  return {
    content: `${beta ? `<@&${role}> ` : ''}new ${release.channel} released: **${release.tag}**`,
    allowed_mentions: { parse: [], roles: [role] },
    embeds: [
      {
        title: '🦋',
        description: [
          `this ${release.channel} is built from [${release.sha.slice(0, 7)}](https://github.com/${repository}/commit/${release.sha}).`,
          '',
          '**download links**',
          ...releaseAssets(release, repository, checksums).map(
            (asset) => `[${asset.name}](${asset.url})`,
          ),
        ].join('\n'),
        color: beta ? 9568176 : 9807270,
        footer: {
          text: beta
            ? 'this beta passed all checks on every platform.'
            : 'back up your notes before installing. nightlies are bleeding edge and may be broken.',
        },
      },
    ],
    attachments: [],
  }
}

export async function sendNightlyWebhook(webhookUrl, payload) {
  if (!webhookUrl) {
    console.log(
      '::notice::NIGHTLIES_WEBHOOK_URL is unset; skipping announcement.',
    )
    return
  }
  let response
  try {
    const url = new URL(webhookUrl)
    url.searchParams.set('wait', 'true')
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new Error('Nightly webhook request failed')
  }
  if (!response.ok)
    throw new Error(`Nightly webhook failed: HTTP ${response.status}`)
}

export function releaseNotes(release, repository, checksums) {
  const url = `https://github.com/${repository}`
  const assets = releaseAssets(release, repository, checksums)
  const download = (label, suffix) => {
    const asset = assets.find(({ name }) => name.endsWith(suffix))
    if (!asset) throw new Error(`Missing nightly download: ${label}`)
    return `[${label}](${asset.url})`
  }
  download('macOS Intel ZIP', '-mac-x64.zip')
  download('macOS Apple Silicon ZIP', '-mac-arm64.zip')
  const commits = release.commits
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, ...subject] = line.split('\t')
      const title = subject.join('\t').replace(/[\\`*_{}[\]<>]/g, '\\$&')
      return `- ${title} ([${sha.slice(0, 7)}](${url}/commit/${sha}))`
    })
  return [
    `this ${release.channel} was built from sha \`${release.sha.slice(0, 7)}\`.`,
    '',
    `**${release.channel}**`,
    '',
    ...(release.channel === 'nightly'
      ? ['**:warning: always back up before using a nightly!**', '']
      : []),
    ...(release.reports ?? []).map(
      (report) =>
        `- ${report.platform}: checks ${report.checks}; package ${report.package}`,
    ),
    ...(release.runUrl ? ['', `[build and test logs](${release.runUrl})`] : []),
    '',
    [
      download('windows', '-win-x64.exe'),
      download('macOS (intel)', '-mac-x64.dmg'),
      download('macOS (apple silicon)', '-mac-arm64.dmg'),
      ...['x64', 'arm64'].flatMap((arch) =>
        ['AppImage', 'deb', 'flatpak'].map((format) =>
          download(`linux ${arch} (${format})`, `-linux-${arch}.${format}`),
        ),
      ),
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
  const readRelease = () => JSON.parse(readFileSync('release.json', 'utf8'))
  const readShards = () =>
    readdirSync('check-shards')
      .filter((name) => name.endsWith('.json'))
      .map((name) =>
        JSON.parse(readFileSync(resolve('check-shards', name), 'utf8')),
      )
  const saveRelease = (release, keys) => {
    writeFileSync('release.json', JSON.stringify(release, null, 2))
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      keys.map((key) => `${key}=${release[key]}\n`).join(''),
    )
  }
  if (process.argv[2] === 'prepare') {
    const run = `${process.env.GITHUB_RUN_NUMBER ?? '0'}.${process.env.GITHUB_RUN_ATTEMPT ?? '0'}`
    const bump =
      process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
        ? process.env.BUMP || 'patch'
        : 'patch'
    const release = nightly('.', new Date(), bump, run)
    if (process.env.GITHUB_RUN_ID)
      release.runUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    saveRelease(release, ['sha'])
  } else if (process.argv[2] === 'decide') {
    saveRelease(decideRelease(readRelease(), readShards()), [
      'channel',
      'tag',
      'version',
    ])
  } else if (process.argv[2] === 'check-shards') {
    const [platform, sha, ...files] = process.argv.slice(3)
    const result = checksFromShards(
      platform,
      sha,
      files.map((file) => JSON.parse(readFileSync(file, 'utf8'))),
    )
    appendFileSync(process.env.GITHUB_OUTPUT, `result=${result}\n`)
  } else if (process.argv[2] === 'classify') {
    saveRelease(
      classifyRelease(
        readRelease(),
        platforms.map((platform) =>
          JSON.parse(
            readFileSync(`installers/checks-${platform}.json`, 'utf8'),
          ),
        ),
        readShards(),
      ),
      ['channel', 'tag', 'version'],
    )
  } else if (process.argv[2] === 'notes') {
    process.stdout.write(
      releaseNotes(
        readRelease(),
        process.env.GITHUB_REPOSITORY,
        readFileSync('installers/SHA256SUMS.txt', 'utf8'),
      ),
    )
  } else if (process.argv[2] === 'notify') {
    if (process.env.NIGHTLIES_WEBHOOK_URL)
      await sendNightlyWebhook(
        process.env.NIGHTLIES_WEBHOOK_URL,
        nightlyWebhook(
          readRelease(),
          process.env.GITHUB_REPOSITORY,
          readFileSync('installers/SHA256SUMS.txt', 'utf8'),
        ),
      )
    else await sendNightlyWebhook('', {})
  } else {
    throw new Error(
      'Usage: node scripts/nightly.mjs prepare|decide|check-shards|classify|notes|notify',
    )
  }
}
