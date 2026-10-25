import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'
import {
  classifyRelease,
  decideRelease,
  platforms,
} from '../scripts/nightly.mjs'
import { promoteFeeds, updateFeed } from '../scripts/update-feed.mjs'
import { updateRelease } from '../src/shared/updates.ts'

const bytes = Buffer.from('a verified installer')
const sha512 = createHash('sha512').update(bytes).digest('base64')
const sha = 'a'.repeat(40)
function release(beta = true) {
  const reports = platforms.flatMap((platform) =>
    [0, 1, 2, 3].map((shard) => ({
      platform,
      sha,
      shard,
      checks: !beta && !shard ? 'failure' : 'success',
    })),
  )
  const decided = decideRelease(
    {
      sha,
      changed: true,
      betaVersion: '0.2.0',
      nightlyVersion: '0.2.0-nightly.20261025.gaaaaaaa.12.1',
      nightlyTag: 'nightly-2026-10-25-aaaaaaa-12-1',
    },
    reports,
  )
  return classifyRelease(
    decided,
    decided.checks.map((report) => ({
      ...report,
      build: 'success',
      package: 'success',
      version: decided.version,
      tag: decided.tag,
      channel: decided.channel,
    })),
  )
}
async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'hibi-feed-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
const suffixes = {
  'win32-x64': 'win-x64.exe',
  'linux-x64': 'linux-x86_64.AppImage',
  'linux-arm64': 'linux-arm64.AppImage',
  'darwin-x64': 'mac-x64.dmg',
  'darwin-arm64': 'mac-arm64.dmg',
}
const asset = (version, suffix) => ({
  name: `hibi-${version}-${suffix}`,
  sha512,
  size: bytes.length,
})
async function installers(root, version) {
  for (const suffix of [
    ...Object.values(suffixes),
    'mac-x64.zip',
    'mac-arm64.zip',
    'linux-amd64.deb',
    'linux-aarch64.flatpak',
  ])
    await writeFile(join(root, `hibi-${version}-${suffix}`), bytes)
}

test('beta and nightly feeds hash real installers and retain immutable electron-updater metadata', async (t) => {
  for (const beta of [true, false]) {
    const root = await directory(t)
    const published = release(beta)
    const { version, tag } = published
    await installers(root, version)
    const feed = await updateFeed(published, root)
    assert.deepEqual(Object.keys(feed).sort(), ['assets', 'tag', 'version'])
    assert.equal(feed.tag, tag)
    assert.equal(feed.version, version)
    assert.deepEqual(
      JSON.parse(await readFile(join(root, 'feed.json'), 'utf8')),
      feed,
    )
    assert.deepEqual(updateRelease(feed, beta ? 'beta' : 'nightly'), feed)
    if (beta) assert.deepEqual(updateRelease(feed, 'nightly'), feed)
    else assert.throws(() => updateRelease(feed, 'beta'))
    assert.deepEqual(
      feed.assets['linux-x64'],
      asset(version, 'linux-x64.AppImage'),
    )
    const names = await readdir(root)
    assert.ok(names.includes(`hibi-${version}-linux-x64.deb`))
    assert.ok(names.includes(`hibi-${version}-linux-arm64.flatpak`))
    assert.ok(
      !names.some((name) => /x86_64|amd64|aarch64|update\.json/.test(name)),
    )
    assert.ok(
      !Object.values(feed.assets).some((entry) =>
        /\.(deb|flatpak)$/.test(entry.name),
      ),
    )
    for (const [platform, name] of [
      ['win32-x64', 'latest.yml'],
      ['linux-x64', 'latest-linux.yml'],
      ['linux-arm64', 'latest-linux-arm64.yml'],
    ]) {
      const metadata = parse(await readFile(join(root, name), 'utf8'))
      assert.equal(metadata.version, version)
      assert.deepEqual(metadata.files, [
        { url: feed.assets[platform].name, sha512, size: bytes.length },
      ])
    }
    const mac = parse(await readFile(join(root, 'latest-mac.yml'), 'utf8'))
    assert.equal(mac.version, version)
    assert.deepEqual(
      mac.files,
      ['x64', 'arm64'].map((arch) => ({
        url: `hibi-${version}-mac-${arch}.zip`,
        sha512,
        size: bytes.length,
      })),
    )
    for (const entry of Object.values(feed.assets)) {
      assert.equal(entry.sha512, sha512)
      assert.equal(entry.size, bytes.length)
      if (entry.zip) assert.equal(entry.zip.sha512, sha512)
    }
    await assert.rejects(
      updateFeed({ ...published, reports: published.reports.slice(1) }, root),
      /Every release platform/,
    )
    await assert.rejects(
      updateFeed({ ...published, version: '0.2.1' }, root),
      /checked release decision/,
    )
  }
})

test('normalization refuses ambiguous aliases and incomplete installers', async (t) => {
  const published = release()
  for (const [alias, canonical] of [
    ['linux-x86_64.AppImage', 'linux-x64.AppImage'],
    ['linux-amd64.deb', 'linux-x64.deb'],
  ]) {
    const root = await directory(t)
    await writeFile(join(root, `hibi-0.2.0-${alias}`), 'alias')
    await writeFile(join(root, `hibi-0.2.0-${canonical}`), 'canonical')
    await assert.rejects(
      updateFeed(published, root),
      /Ambiguous Linux packages/,
    )
    assert.equal(
      await readFile(join(root, `hibi-0.2.0-${alias}`), 'utf8'),
      'alias',
    )
    assert.equal(
      await readFile(join(root, `hibi-0.2.0-${canonical}`), 'utf8'),
      'canonical',
    )
  }
  const root = await directory(t)
  await assert.rejects(
    updateFeed(published, root),
    /Missing or ambiguous updater package/,
  )
  await installers(root, published.version)
  await rm(join(root, 'hibi-0.2.0-mac-x64.zip'))
  await assert.rejects(updateFeed(published, root), /Missing updater ZIP/)
})

function github() {
  const calls = []
  const refs = new Map([
    ['beta', 'b'.repeat(40)],
    ['nightly', 'c'.repeat(40)],
  ])
  const assets = new Map([
    ['beta/feed.json', 'previous beta'],
    ['nightly/feed.json', 'previous nightly'],
    ['nightly/update.json', 'frozen forward'],
    ['nightly-green/update.json', 'frozen recommended forward'],
    ['nightly-green/recommended-nightly.json', 'frozen pointer'],
  ])
  const gh = (...args) => {
    calls.push(args)
    if (args[0] === 'api') {
      if (args[1] !== '--method') {
        const channel = args[1].split('/').at(-1)
        if (!refs.has(channel)) throw new Error('not found')
        return JSON.stringify({ object: { sha: refs.get(channel) } })
      }
      const channel =
        args[2] === 'PATCH'
          ? args[3].split('/').at(-1)
          : args
              .find((arg) => arg.startsWith('ref=refs/tags/'))
              .split('/')
              .at(-1)
      refs.set(channel, args.find((arg) => arg.startsWith('sha=')).slice(4))
    } else {
      assert.ok(
        ['beta', 'nightly'].includes(args[2]),
        'immutable and legacy releases are never modified',
      )
      if (args[1] === 'upload') {
        assert.equal(basename(args[3]), 'feed.json')
        assets.set(`${args[2]}/feed.json`, 'new feed')
      }
    }
    return '{}'
  }
  return { gh, calls, refs, assets }
}

test('beta advances both rolling prereleases; nightly advances only nightly and never writes frozen files', async (t) => {
  for (const beta of [true, false]) {
    const root = await directory(t)
    const published = release(beta)
    await installers(root, published.version)
    await updateFeed(published, root)
    const mock = github()
    await promoteFeeds(published, root, 'owner/repo', mock.gh, () => true)
    const uploads = mock.calls.filter((args) => args[1] === 'upload')
    assert.deepEqual(
      uploads.map((args) => args[2]),
      beta ? ['beta', 'nightly'] : ['nightly'],
    )
    assert.equal(mock.assets.get('nightly/update.json'), 'frozen forward')
    assert.equal(
      mock.assets.get('nightly-green/update.json'),
      'frozen recommended forward',
    )
    assert.equal(
      mock.assets.get('nightly-green/recommended-nightly.json'),
      'frozen pointer',
    )
    for (const args of mock.calls.filter((args) =>
      ['create', 'edit'].includes(args[1]),
    )) {
      assert.ok(args.includes('--prerelease'))
      assert.ok(args.includes('--latest=false'))
    }
    if (!beta) assert.equal(mock.assets.get('beta/feed.json'), 'previous beta')
  }
})

test('beta ancestor guard preserves newer feed; first promotion creates rolling tags and releases', async (t) => {
  const root = await directory(t)
  const published = release()
  await installers(root, published.version)
  await updateFeed(published, root)
  const mock = github()
  const ancestry = []
  await promoteFeeds(
    published,
    root,
    'owner/repo',
    mock.gh,
    (previous, next) => {
      ancestry.push([previous, next])
      return false
    },
  )
  assert.deepEqual(ancestry, [['b'.repeat(40), sha]])
  assert.equal(mock.assets.get('beta/feed.json'), 'previous beta')
  assert.equal(mock.refs.get('beta'), 'b'.repeat(40))
  assert.ok(
    !mock.calls.some((args) => args[0] === 'release' && args[2] === 'beta'),
  )
  assert.equal(mock.assets.get('nightly/feed.json'), 'new feed')
  const first = github()
  first.refs.clear()
  const gh = (...args) => {
    if (args[0] === 'release' && args[1] === 'view')
      throw new Error('not found')
    return first.gh(...args)
  }
  await promoteFeeds(published, root, 'owner/repo', gh)
  assert.deepEqual(
    first.calls.filter((args) => args[1] === 'create').map((args) => args[2]),
    ['beta', 'nightly'],
  )
  assert.equal(first.refs.get('beta'), sha)
  assert.equal(first.refs.get('nightly'), sha)
  await writeFile(
    join(root, 'feed.json'),
    JSON.stringify({ tag: 'v0.1.0', version: '0.1.0' }),
  )
  await assert.rejects(
    promoteFeeds(published, root, 'owner/repo', first.gh),
    /must pin the published release/,
  )
})
